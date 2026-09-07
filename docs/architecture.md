# Architecture

Status: proposed. Read [decisions](decisions.md) for assumptions and [delivery](delivery.md) for the prototype gates.

Openmind is intended as a clinical therapy application. Its Rust backend should own the user's vault, conversation state, provider connections, internal memory, and user-facing notebook updates. The React interface displays conversations and asks for narrow operations. A model receives only the context needed for the current task. Clinical intent does not establish clinical effectiveness; see the [clinical development requirements](conversation-policy.md#clinical-development-and-jurisdictions).

## System boundaries

```mermaid
flowchart TB
    subgraph Device[User device]
        UI[React and TypeScript UI]
        Core[Rust application core]
        Policy[Conversation policy and response checks]
        Memory[Memory retrieval and validated updates]
        Notes[User notebook]
        Speech[Local speech-to-text adapter]
        Vault[(SQLCipher vault)]
        Keys[OS key store and vault unlock]
        Schedule[Session scheduler and native reminders]
        Router[Provider adapters and network policy]
        Ollama[Ollama with local model]
        UI <-->|Typed commands and scoped events| Core
        Core <--> Policy
        Core <--> Memory
        Core <--> Notes
        Notes <--> Vault
        UI <-->|Explicit dictation| Speech
        Memory <--> Vault
        Core <--> Vault
        Keys --> Core
        Core <--> Schedule
        Core <--> Router
        Router <-->|Loopback| Ollama
    end
    Remote[Optional remote model endpoint]
    Releases[Signed release artifacts]
    Router <-->|Explicit user consent over TLS| Remote
    Releases -->|User-controlled updates| Core
```

The local runtime is a separate trust boundary even when it runs on the same computer. It sees plaintext prompts and may have its own logging and networking behavior. Openmind has no conversation backend, account service, or required hosted database.

## Proposed stack

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Windows, native commands, menus, dialogs, notifications, packaging, updater |
| Interface | React, TypeScript, Vite | Conversation, session history, user notebook, memory controls, settings |
| Styling | Tailwind CSS with shared semantic tokens | Implement `DESIGN.md`; accessible headless primitives where useful |
| Frontend tooling | Bun | Dependency management and scripts; not a required runtime on users' machines |
| Application core | Rust, Tokio, Serde, an HTTP client | Typed state transitions, provider streaming, validation, persistence |
| Persistence | SQLite through a SQLCipher-enabled Rust binding | Encrypted chat, memory graph, full-text index, jobs, settings |
| Secret storage | Native key store plus passphrase wrapping | Keys stay out of frontend storage and logs |
| Inference | Ollama adapter plus compatible HTTP adapter | Separate conversation, extraction, and optional embedding capabilities |
| Speech input | Local whisper.cpp adapter, subject to prototype evaluation | Optional dictation into an editable draft; no model speech output at launch |
| Tests when implemented | Cargo tests, frontend component tests, browser UI tests, native platform smoke tests | Verify behavior at each boundary |

Tauri uses a Rust core and OS webviews. That fits this split, but means macOS and Windows need separate rendering and native integration checks. This is a design recommendation based on [Tauri's architecture](https://v2.tauri.app/concept/architecture/), not a measured performance comparison.

Use a client application built by Vite. There is no need for Next.js server rendering in this desktop product. Keep durable state in Rust. Start with React component state and a small subscription layer for session events. Add Zustand or TanStack Query only if UI coordination or cache behavior warrants them; do not duplicate the vault in a global frontend store.

## Core modules

| Module | Owns | Must not do |
| --- | --- | --- |
| `vault` | Unlock, migrations, transactions, backup, deletion | Return keys or arbitrary SQL access to the webview |
| `sessions` | Session lifecycle, turn IDs, transcript persistence, cancellation | Assume that a network retry is a new user message |
| `providers` | Endpoint config, credentials, capability probes, stream normalization | Change a provider or send history remotely without user action |
| `policy` | Versioned guidance, context limits, input and output checks | Claim perfect detection or clinical expertise |
| `memory` | Evidence, candidate extraction, graph operations, retrieval | Treat an inference as a user-confirmed fact |
| `notebook` | User-visible takeaways, proposed next steps, editing, provenance | Publish internal hypotheses or overwrite a user's edits |
| `speech` | Microphone lifecycle, local transcription, later output adapter | Record without action, auto-submit uncertain speech, or enable remote audio implicitly |
| `scheduler` | Recurrence, notification bookkeeping, restart reconciliation | Start an AI conversation while the user is absent |
| `platform` | Key store, notifications, tray, lock/suspend signals | Let the model call native APIs |

Use a modular application in one core process. Extraction is a serialized background job, not a separate agent service. A second process is justified for a future managed inference runtime, not for every internal module.

## Provider contract

Each configuration records `provider_id`, adapter type, base URL, execution location, model identifier or digest where available, secret reference, capability results, and consent version. Never embed credentials in URLs.

Required operations are connection testing, completion generation, and cancellation. A provider must support streaming to meet the launch response requirement and validated structured output to meet the three-result workflow. Model discovery and embeddings remain optional. A development adapter may expose limited modes with clear labels, but those modes do not qualify as the complete clinical product. Normalize outcomes into connection unavailable, authentication failed, unsupported feature, rate limited, context exceeded, cancelled, and provider failure. Error messages must not echo request bodies or authorization headers.

The compatible adapter speaks the widely implemented `/v1/chat/completions` request format. Ollama documents support for this protocol, but compatibility is partial and differs by operation. Keep an Ollama-native adapter for runtime metadata and native features. Verify roles, streaming frames, context settings, JSON schema behavior, and errors against each supported server. See [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

Do not require tool calling for memory. Ask for separate internal-memory and user-notebook patches in one structured follow-up call, then validate them in Rust. This produces three results with two main model calls. No-op patches are valid when there is nothing useful to retain. If a provider cannot reliably return structured data, mark it incompatible with the complete workflow. Never silently accept malformed output. See [turn processing](turn-processing.md) for ordering and failure behavior.

The provider and model are fixed for each turn. Switching requires an explicit action and a new consent check before sending prior history or retrieved memory. Snapshot the provider configuration version when work is queued so a later settings edit cannot reroute an old job.

## Local execution and remote consent

- Default to an explicitly configured loopback endpoint. Do not scan the user's LAN or expose a listening Openmind HTTP service.
- Treat a LAN-hosted model as remote to this device. Require TLS and a deliberate setup flow; it is not equivalent to an on-device model.
- A local address can proxy to a cloud model. Record endpoint location and model execution location separately. If execution cannot be verified, label it unknown rather than claiming offline privacy.
- For Ollama local mode, require a locally available model and guide users to disable cloud features. Ollama documents `OLLAMA_NO_CLOUD=1` and a server configuration option. Openmind must not rewrite a user's existing Ollama configuration without permission. See [Ollama's FAQ](https://docs.ollama.com/faq).
- Remote consent covers the provider host, messages, retrieved memories, extraction, and any embedding requests. Enabling remote chat must not automatically enable remote embeddings or background extraction.
- In local mode, no application-initiated remote requests occur during conversation. Updates and model downloads are separate user actions. Verify this with network monitoring; a third-party server's claims are not proof of its behavior.
- Providers cannot read files, invoke shell commands, browse, or contact people. Model output is data.

## One conversation turn

```mermaid
flowchart TD
    Input[Submitted text or confirmed transcription]
    Save[Encrypt and persist input with pending work]
    Context[Retrieve existing memory and recent unsummarized turns]
    Reply[Call 1: stream the reply through output checks]
    Writer[Call 2: produce both note patches]
    Validate[Validate sources, output rules, and revisions]
    Internal[Encrypted internal memory]
    Notebook[Encrypted user notebook]
    Input --> Save --> Context --> Reply --> Writer --> Validate
    Validate --> Internal
    Validate --> Notebook
```

Persist input before inference. Stream text progressively in checked sentence-sized units, with bounded buffering and a stop control. Full-response buffering is reserved for cases requiring additional review. Partial-output checks cannot prevent every harmful implication in a later continuation and cannot undo text already displayed. Evaluate this tradeoff before clinical deployment.

Once the reply finishes, one structured follow-up call proposes both note updates. Commit the two validated patches atomically; preserve the reply if note generation fails. Mark interrupted replies and exclude their assistant content from derivation, while allowing valid user disclosures to be processed. Keep the same logical turn ID and distinct attempt IDs on retry. Never silently change provider.

Run at most one large-model generation at a time on the initial local configuration. Prioritize conversation over note generation, suspend pending work when locked, and include recent unprocessed source turns in later context so note lag does not erase continuity. The [turn-processing specification](turn-processing.md) defines queue coverage, revisions, streaming recovery, and latency measurements.

## Context construction

Order context as fixed behavioral policy, explicit user preferences, current session summary, retrieved memories with evidence labels, recent turns, and current user input. Mark quoted material and retrieved text as untrusted content. Never interpolate retrieved text into system policy or tool definitions.

For a validated 8,192-token model configuration, an initial test budget is 1,500 tokens of policy, 1,200 of memory, 3,500 of recent conversation including the current message, 1,200 reserved for output, and 792 for format overhead. These are tunable targets. Verify actual token accounting per adapter; conservative estimates need extra headroom.

Keep the current user turn and fixed policy intact. Trim low-ranked memories and older history first. If the message cannot fit, ask the user to shorten it or select a capable model. Never silently cut away the user's meaning or the policy. Cache summaries with source revisions and invalidate them after edits or deletion.

## Sessions and reminders

Sessions have `open`, `paused`, and `completed` states. A planned session is a calendar intention, not a reservation of the AI. Starting a spontaneous conversation uses the same session engine. User notes update during the conversation; session closure can consolidate them into an editable summary without requiring another call when the existing notes are sufficient.

Persist recurrence as local wall time, IANA timezone, next UTC occurrence, and a DST policy. Default to following the selected timezone rather than silently following travel. For a nonexistent DST time, move to the next valid time; for a repeated time, notify once. Let users change that behavior explicitly.

The baseline reminder runs while Openmind is open or in its opt-in tray mode. A closed app or sleeping device cannot be assumed to run timers. On startup and wake, reconcile missed occurrences once, without a notification burst. Reliable delivery after full quit requires a verified native scheduling implementation on each platform; do not promise it until tested. Native notifications contain generic text and an opaque session reference, never a life-event summary.

When the vault is locked, model work stops. If reminders remain enabled, a separate minimal OS-protected scheduling cache stores only occurrence times and opaque IDs. The UI explains that reminder timing exists outside the main vault. Lock handling also clears visible conversation state and cancels queued work.

## Planned source layout

The paths below are future implementation structure, not existing runnable files.

```text
src/
  app/                 navigation, providers, window shell
  features/
    conversation/
    sessions/
    memory-controls/
    notebook/
    settings/
  components/          shared accessible UI
  lib/                 typed native client, event subscriptions
src-tauri/
  src/
    vault/
    sessions/
    providers/
    policy/
    memory/
    notebook/
    speech/
    scheduler/
    platform/
  migrations/
  capabilities/
policies/              versioned guidance and schema definitions
evals/                 synthetic scenarios and expected behavior
docs/
```

Generate or check TypeScript command types from Rust types at the boundary. Initial commands include `unlock_vault`, `start_session`, `send_message`, `cancel_turn`, `list_sessions`, `list_remembered_facts`, `correct_memory`, `forget_topic`, `list_user_notes`, `edit_user_note`, `start_dictation`, `stop_dictation`, and `configure_provider`. Every command validates locked state, profile ownership, sizes, and IDs. Do not expose `execute_sql`, arbitrary file reads, or a generic tool runner. Dictation commands are conditional on the input clarification.

Scope events to the active window and session. Include monotonically ordered event numbers and the turn ID so stale chunks cannot land in a new conversation. Clear subscriptions and frontend caches on lock. Tauri capabilities need explicit configuration, including restrictions on custom commands, which are broadly callable by default unless configured. See [Tauri capabilities](https://v2.tauri.app/security/capabilities/).
