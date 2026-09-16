# Desktop engineering preview

The first implementation is a single-user desktop foundation. It is not an evaluated clinical product. Use synthetic conversations while developing it.

## Implemented

- Tauri 2 shell and a Geist-inspired React interface with bundled Geist fonts, light/dark/system appearance, searchable session history, responsive navigation, and keyboard-accessible dialogs.
- Passphrase creation and unlock, encrypted sessions and messages, explicit lock, and interrupted-reply recovery.
- A random 32-byte SQLCipher database key, wrapped using Argon2id and XChaCha20Poly1305. The authenticated envelope fixes and bounds KDF parameters. A vault file lock prevents two app processes from opening it simultaneously.
- Ollama model discovery and streaming over an explicitly configured HTTP loopback endpoint. The adapter rejects redirects, proxies, non-loopback hosts, and recognized cloud model metadata. The runtime remains a separate trust boundary.
- One active generation, stop control, persistence before displaying chunks, and rejection of late writes after locking.
- A second, structured Ollama call after a completed reply proposes internal memory and user notes together. Both branches require exact quotes from the current user message and commit in one encrypted transaction. Empty patches are valid. Quotes establish provenance, not semantic or clinical correctness.
- An editable notebook with source links and revision checks. Generation adds records for its own turn and cannot overwrite existing edits. Note deletion erases its content while retaining a tombstone. Conversation deletion cascades to its messages, notebook entries, internal memory, and note jobs.
- Bounded retrieval of internal memory for later replies, clearly marked as untrusted historical context. User corrections take priority over generated records; current input takes priority in the context budget.
- A separate Remembered context workspace with grouped statements, search, visible source evidence, conversation links, revision-checked corrections, and explicit forgetting controls. The browser demo provides fictional records with temporary edits.
- Conversation controls with editable titles and independent remembered-context and notebook-saving switches, stored in the encrypted vault with revision checks. Off states remain visible in the conversation.
- Durable notes jobs and explicit retry without resending the reply. Cancelled, interrupted, or malformed derivations leave existing notes intact. Reopening a vault marks unfinished jobs as failed. Completed replies can retry notes; interrupted replies do not generate notes.
- Migration from conversation-only and paired-notes vaults to schema version 4, including memory revisions, source exclusions, conversation preferences, and per-job output permissions. Unknown future schemas are refused.
- A separate seeded demo vault opened with one click. It cannot unlock or replace the personal vault.
- At most 20 recent messages and 6,000 UTF-8 bytes of conversation context. Each request asks for an 8,192-token context and at most 1,024 output tokens. Extended thinking is disabled in the request. These are conservative prototype limits, not validated budgets for every model or tokenizer.

## Remembered context controls

Corrections update the selected record with a revision check, retain its original source quote, and mark the new wording as user-confirmed. Retrieval labels the correction separately from that original evidence and prioritizes corrected records. The controls are unavailable during an active reply or notes update; the user can stop the operation first.

Forgetting is scoped to the selected source message. Confirmation shows the affected memories and notebook entries, including any edited notes. The transaction clears those derived records and keeps a content-free source exclusion so a retry cannot recreate them. The original user message and its associated assistant reply remain readable in history but are excluded from later model context. Existing backups and provider copies are unchanged. This is not topic-wide forgetting: separately sourced disclosures and later messages can still contain the same information. Delete the conversation to remove its history and derived records from the active vault.

The browser view offers a clearly labeled synthetic sample. Native vault and inference operations require the desktop shell. Connection and reading preferences currently last only for the open app instance. Only the appearance preference is saved in webview local storage.

## Conversation controls

Each conversation starts with remembered context and notebook saving enabled. Conversation controls can rename it or change either preference. Disabling remembered context stops saved-memory retrieval in that conversation and prevents new memory records; disabling notebook saving stops new notebook entries. Existing memories and notes remain until explicitly deleted. The transcript is still saved and used as recent context in the conversation, so these switches do not create a private session.

Turning a switch off also revokes that output for outstanding updates in the conversation. Turning it back on does not process messages submitted while it was off. Each job retains its permitted outputs across retries and restarts. When neither output is permitted, Openmind skips the follow-up provider request. Settings cannot change during an active reply or notes update; stop that operation first.

## Subscription bridge checkpoint

An experimental ChatGPT subscription adapter using Codex App Server is checked in for the native demo, with explicit remote consent enforced in Rust. CLI sign-in and model discovery were probed; live adapter generation and native integration still need verification. See [the checkpoint and next steps](codex-testing.md).

## Not implemented

Entity reconciliation and explicit relationships between memory nodes, semantic retrieval, topic-wide forgetting, summaries, transcript editing, remote APIs, speech input/output, reminders, keychain convenience unlock, OS lock/suspend handling, automatic idle lock, encrypted backup/export, and signed updates are future work.

The current extraction reads only the user message for its turn. It does not derive commitments from the assistant response, merge older entities, or process interrupted replies. One model request runs at a time, so a new reply waits until the notes request finishes or is stopped. This is the first implementation of the two-call design, not the complete job scheduling and graph specification. Deleting a notebook entry does not remove its source or internal memory; delete the conversation to remove all of those records from the active vault. Existing backups are outside that deletion.

The current prompt is basic experimental guidance. There is no clinical input classifier, sentence-level output review, crisis detection evaluation, or clinical efficacy evaluation. Stream batching is for rendering and database efficiency; it is not safety review. UI state is cleared on lock, but JavaScript strings and model-runtime memory cannot be reliably erased. Locking closes Openmind's database connection and cancels its generation request; it does not unload a third-party runtime's model or erase its logs. Cancellation is cooperative, so the in-flight task may retain plaintext briefly after the lock command returns.

No passphrase reset or recovery exists. Losing the passphrase loses access. A crash during initial creation can leave an incomplete vault, which the app refuses to overwrite. Only remove such files after establishing that they contain no data you need. The storage format is experimental and has not received an independent security audit.

No app account, content telemetry, conversation server, or automatic model download is included. Install and configure Ollama separately. Set `OLLAMA_NO_CLOUD=1` when starting its server for local use; a loopback address alone cannot prove local execution. Do not use the small live-test model as a clinical model recommendation.

## Local development

Install Bun 1.4.2, Rust 1.98.0, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). macOS needs Xcode command-line tools. Windows needs the MSVC build tools and WebView2. Vendored SQLCipher/OpenSSL also needs a working C compiler, Perl, and platform build tooling. On Arch Linux, install `webkit2gtk-4.1`, a build toolchain, and CMake. Ollama is a separate optional installation.

```sh
bun install --frozen-lockfile
bun run build
bun run test
bun run test:core
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

## Test access

Choose **Open demo** on the welcome or lock screen. No personal account or vault setup is needed.

| Field | Value |
| --- | --- |
| Demo login ID | `demo` |
| Demo password | `openmind-demo-2026` |

The button supplies these public demo credentials automatically. They apply only to the separate `demo-vault` directory beside the personal `vault`. Three fictional conversations and three notes are seeded on first use. Demo edits persist between visits; the browser sample is temporary. The demo password is deliberately public, so use fictional input only. A model connection is required for new generated replies and notes; reading and editing seeded notes works without Ollama. Deleting every demo conversation causes fixtures to be seeded again on the next demo open.

Start the native development app when wanted:

```sh
bun run tauri dev
```

For an unsigned local native build without an installer:

```sh
bun run tauri build --no-bundle
```

Bundle configuration targets macOS app/DMG and Windows NSIS. Run native builds on the target OS. Signing identities, notarization credentials, installer smoke tests, and release automation are still required before publishing installers. The workflow currently checks compilation and tests on macOS and Windows; it does not publish releases.

The vault lives under Tauri's per-user app-data directory for `io.github.kreatzzz.openmind`, in its `vault` subdirectory. Do not commit that directory or include it in issue reports. Examples and tests must contain only synthetic text.

Ignored provider smoke tests can connect to a separately started Ollama instance:

```sh
OPENMIND_TEST_OLLAMA_URL=http://127.0.0.1:11439 \
OPENMIND_TEST_MODEL=qwen3:0.6b \
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features live_ -- --ignored
```

These verify streaming and structured extraction using synthetic prompts. It does not assess therapeutic behavior.

## Linux startup troubleshooting

On Arch, install the runtime dependencies through the package manager:

```sh
sudo pacman -S --needed webkit2gtk-4.1 cmake ollama
```

The previous user-cache extraction was sufficient to compile, but failed at startup because the packaged WebKit library launches helper executables from `/usr/lib/webkit2gtk-4.1`. A library search path alone does not relocate those helpers. Use the system installation for running the app.

If startup reports a Wayland protocol error or `Failed to create GBM buffer`, try the app with WebKit's DMA-BUF renderer disabled:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run tauri dev
```

This was verified on the development machine on September 8, 2026: the native Wayland window opened and rendered the vault setup screen. The setting applies only to this invocation. It does not change compositor configuration or disable the WebKit sandbox. No X11 override was needed with this setting.

## Verification recorded September 8, 2026

The production frontend build, 11 UI tests, 44 core regression tests, Clippy with warnings denied, formatting, and native Linux compilation pass. Two opt-in live Ollama tests pass using `qwen3:0.6b`, covering streaming and structured notes extraction. Native keyboard testing opened the separate demo, sent a fictional message, displayed the saved reply, and completed the notes update. Browser checks covered the notebook editor, dark appearance, and narrow layouts without page errors or horizontal overflow.

The small Ollama fixture establishes protocol operation only. Its responses have not passed the proposed conversation-policy evaluations and must not be treated as clinical guidance. macOS CI passed the Geist/demo revision. Windows exposed an HTTP fixture that closed without draining POST bodies; that fixture is corrected in this checkpoint and awaits a CI rerun. The pull request tracks subsequent checks. Signed installers remain unverified.

## Verification recorded September 12, 2026

The remembered-context implementation passes the production frontend build, 17 UI tests, 48 core regression tests, native macOS compilation, formatting, and all-target Clippy with warnings denied. Three opt-in live-provider tests were not run. Regression coverage includes populated schema-v2 migration followed by forgetting, correction persistence, source-history exclusion, stale derivation rejection, linked-note deletion, and UI refresh failures.

A production-build browser check using synthetic data exercised correction, source-scoped forgetting and linked-note removal, light/dark appearance, reduced motion, and desktop/narrow layouts without page errors or horizontal overflow. This does not establish native VoiceOver/NVDA accessibility, Windows behavior, live inference quality, or signed installer readiness. macOS and Windows CI runs on the pull request; native manual accessibility and installer checks remain outstanding.

## Conversation controls verification

The conversation-controls increment passes 23 UI tests and 57 core regression tests, the production frontend build, native macOS compilation, formatting, and all-target Clippy with warnings denied. Three opt-in live-provider tests were not run. Tests cover independent output branches, skipping both-disabled jobs, messages submitted while saving was disabled, revocation across restart/re-enable/retry, active-work restrictions, revision conflicts, title limits, and schema-v3 migration preserving forgotten-source exclusions. Earlier schema migrations remain covered.

Production-build browser checks with fictional data cover title changes, independent switches, visible off states, retained memory records, light/dark dialogs, reduced motion, and narrow layouts without page errors or horizontal overflow. Native screen-reader and Windows manual testing remain outstanding; both platform CI jobs run on the new pull request. The preceding remembered-context PR passed macOS and Windows CI before merging.
