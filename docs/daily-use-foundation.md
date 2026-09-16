# Daily-use foundation

This September 16 increment implements the four engineering priorities requested after the readiness audit. It does not establish clinical effectiveness or release readiness.

## Provider setup and conversation flow

Provider endpoint, model, consent, and reading preferences live in the encrypted vault. The UI never receives a saved API key back from Rust. Local Ollama remains the default. An OpenAI-compatible adapter supports chat streaming and structured notes; non-loopback destinations require HTTPS and explicit consent. Redirects, URL credentials, query strings, and fragments are rejected. There is no automatic remote fallback.

Connection checks establish reachability and configuration, not the quality of a model or its reliability at producing valid notes. Malformed structured output cannot change saved notes. Background notes jobs persist permission and provider snapshots, retry at most three times with backoff, and yield to a new reply. A completed reply stays saved if its notes request fails. Changing remote configuration or credentials revokes outstanding remote job consent rather than sending a new credential to an old destination.

The ChatGPT subscription bridge remains limited to the native example workspace. It uses official Codex sign-in, has no API-billing fallback, and still needs a live generation test. It is not a general production ChatGPT subscription integration.

## Relevant memory

FTS5 searches source-backed memory in the SQLCipher vault. Optional Ollama embeddings are limited to a loopback endpoint and stored in the same vault. No embedding model is downloaded automatically. Exact local vector scanning and reciprocal-rank fusion combine semantic and keyword candidates; the lexical path remains usable when embeddings are unavailable.

Five existing record kinds remain compatible with saved vaults. Seven overlapping index views organize retrieval without making every disclosure fit one psychological category. They are a product taxonomy, not a diagnostic classification. Report time is stored separately from claims about when an event happened. The extractor still handles one user message at a time; identity reconciliation and an explicit relationship graph are not implemented.

Corrections invalidate old vectors. Forgetting removes eligible derived records and excludes their source turn from future model context. Rebuilds do not backfill memory-disabled messages. Async retrieval rechecks the unlocked vault, session permission, record/index epoch, and selected embedding configuration before releasing context. Private conversations never query this index.

The fallback budget uses conservative UTF-8 byte limits and a hard ceiling, not a claim that bytes equal tokens. Current input keeps priority. Warm synthetic keyword benchmarks at 1,000, 10,000, and 100,000 records are recorded in `test-results/retrieval-benchmark-2026-09-16.md`; these do not measure semantic-model latency or clinical recall quality.

The subsequent [memory-quality evaluation](evaluations/memory-quality-2026-09-16.md) compares keyword and live hybrid retrieval on 18 synthetic questions. Both retrieved the intended memory on 16 questions; the small embedding model added an irrelevant result for one of two unknown questions. The report also records extraction errors, correction/forgetting checks, and the limits of exact-quote validation. Passing schema validation is not evidence that a generated memory is accurate.

## Vault controls

Encrypted backups contain a checkpointed SQLCipher database and an authenticated encrypted envelope. A separate backup passphrase becomes the unlock passphrase after restore. Restore validates a staged vault before replacing the current one and preserves recovery copies on failure. Passphrase changes rewrap the database key without rewriting conversation data.

Private conversations live in process memory and create no saved transcript, note, memory, or derivation-job records. Lock, quit, and renderer reconnect clear them. They still send their current conversation to the chosen provider; private mode does not control that provider's logs or retention.

A native timer enforces configurable idle locking. Tauri resume events also lock an open vault. Windows now subscribes to current-session lock, console/remote disconnect, and suspend events. macOS subscribes to documented session-resign, system-sleep, and screen-sleep notifications; a normal awake screen lock is not covered by those notifications. Actual OS lock/suspend checks on Windows and macOS, plus a supported macOS awake-lock signal, remain release work. Retention settings select an age threshold; pruning requires an explicit action and confirmation. Reset deletes the active personal vault. Neither operation deletes exported backups or provider-held copies.

## Plans and accessibility

Plans support one-time, daily, or weekly recurrence with an IANA timezone. The scheduler advances past missed occurrences without sending a burst of reminders. For a spring-forward gap it uses the first valid local minute; for an overlapping local time it chooses the earlier occurrence. Optimistic revisions prevent an old editor from replacing a newer plan.

Reminders run while the desktop process is open and its vault is unlocked. OS permission is requested only when reminders are enabled. Notifications use generic text, without conversation titles or content. Delivery while the app is fully quit, a tray lifecycle, and retry after an OS notification failure are not implemented.

The interface includes light, pure-black dark, and system appearance, five accent colors, text scaling, line width, reduced motion, and a configurable Enter-to-send shortcut. Theme preferences contain no conversation data. Native screen-reader testing and platform zoom verification remain release checks.

## Before a release

- Validate a supported local chat/embedding model and one chosen compatible remote endpoint with synthetic end-to-end conversations, including interruption, restart, and long histories.
- Evaluate retrieval relevance, incorrect identity matches, prompt injection, extraction mistakes, and correction/forgetting behavior across representative histories.
- Verify native lock/resume, file dialogs, notification permissions, timezone changes, and accessibility on both Windows and macOS.
- Build signed installers, test installation and updates, and choose supported hardware and model requirements.
- Define clinical intended use, population, jurisdiction, oversight, crisis-response behavior, and evaluation criteria before clinical deployment.
- Resolve product decisions on speech input, transcript editing, relationship mapping, licensing, and whether reminders should run after closing the window.

## Local verification

The figures below describe the earlier daily-use increment. The follow-up evaluation and desktop release work are tracked in the [memory-quality report](evaluations/memory-quality-2026-09-16.md) and [release checklist](desktop-release.md). Native bundle workflows and a signing-gated draft release workflow are implemented; signing credentials and physical-device release checks remain outstanding.

The integrated backend passed 103 regression tests on Windows; 26 UI tests and the production frontend build also passed. Both opt-in Ollama smoke tests passed against the already-installed `qwen3.5:4b`: one streamed a synthetic reply, and one produced a valid source-backed notes patch. No model was downloaded and no remote inference request was made. This checks protocol behavior, not clinical response quality. Browser checks covered pure-black surfaces in explicit and system dark mode, light appearance, accent selection, planned-session creation and overview refresh, and 320px/390px/1280px layouts without horizontal overflow. Required macOS and Windows checks are recorded on the pull request.
