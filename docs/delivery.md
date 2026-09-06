# Delivery plan

Status: proposed sequencing and release criteria. This phase produces documents only. No installer, application code, CI workflow, or release has been built.

## Milestones

| Stage | Deliverable | Exit evidence |
| --- | --- | --- |
| 0. Product decisions | Resolve support versus clinical scope, memory access, input mode, launch audience, and license | Updated decision log; agreed v1 boundaries |
| 1. Native feasibility | Minimal Tauri window with encrypted save/unlock, native key storage, Ollama request, cancellation, and local build on each target | Working signed test artifact where credentials exist; evidence that SQLCipher and key store work on macOS and Windows |
| 2. Conversation prototype | Designed onboarding, model connection, one text session, buffered response review, retries, lock, and persistence | End-to-end local conversation with network trace, failure recovery, and keyboard use |
| 3. Memory continuity | Evidence-backed nodes/edges, retrieval, corrections, forgetting, summaries, and extraction queue | Synthetic multi-session scenarios and deletion/concurrency tests pass |
| 4. Daily-use features | History, planned sessions, reminders, private sessions, portable encrypted backup, retention settings | Restart, sleep/wake, timezone, full-quit limitations, and restore verified |
| 5. API support | One tested compatible endpoint, BYOK setup, explicit remote consent, adapter capability failures | Contract tests and proof that local mode never falls back remotely |
| 6. Evaluated beta | Recommended model configuration, reviewed guidance, security review, accessibility, installers, signed update path | Documented release gates below; unresolved severe issues block beta |
| Later | Voice, managed model installation, sync, additional languages, mobile, or clinician features | Separate decisions and scoped plans |

Do not spend the first milestone building a graph visualization. The first vertical slice should prove that a session can persist securely and run through a local model on both operating systems. Native packaging and SQLCipher integration are the early technical risks.

Do not commit dates before measuring prototype latency and onboarding friction. A voice-at-launch decision expands stages 1, 2, and 6. Clinical positioning changes stage 0 and the entire evidence process.

## macOS and Windows distribution

| Platform | Initial proposed target | Artifact and build strategy |
| --- | --- | --- |
| macOS | Apple Silicon; exact minimum macOS version chosen after dependency checks | Native macOS CI runner builds `.app` and `.dmg`; Developer ID signing, notarization, and stapling |
| Windows | Windows 11 x64; exact supported builds documented before beta | Native Windows CI runner builds a signed per-user NSIS `.exe` installer |
| Optional follow-up | Intel Mac and Windows ARM64 | Add only with matching SQLCipher/runtime dependencies and physical-device QA |

These are proposed support targets, not Tauri's minimum system requirements. Model inference hardware requirements are separate from the app shell requirements. A machine may run the interface well while its chosen model runs poorly.

Tauri documents [macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/) and [Windows installer formats](https://v2.tauri.app/distribute/windows-installer/). Use native runners for the first distribution pipeline to reduce cross-compilation surprises.

Obtain the relevant Apple developer identity and Windows signing arrangement before consumer distribution. Timestamp Windows signatures and test installer/uninstaller behavior as a standard user. Signing is necessary for a credible release process, but does not guarantee the absence of reputation warnings on every Windows machine. See [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

Windows uses WebView2. Provide a standard installer and plan an offline-capable package with the required WebView2 runtime when needed. Do not describe a bootstrapper that downloads prerequisites as a fully offline installer. On macOS, test the system webview on the minimum supported OS as well as a current version.

The initial application connects to an existing Ollama installation. It does not bundle model weights or run a silent system installer. Onboarding detects missing runtime/model and gives a clear next step. Benchmark the experience with nontechnical users; if it is too difficult, make managed runtime installation a prerequisite for consumer beta rather than hiding the friction.

Before redistributing any weights or bundled runtime, record license terms, source, hashes, supported hardware, disk footprint, and download integrity. A future llama.cpp sidecar must be signed as part of the application distribution, bind to loopback with an application secret, and have an explicit child-process lifecycle. Its [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) provides a basis for a later prototype, not a reason to add it now.

Use direct downloads via GitHub Releases first. App Store and Microsoft Store distribution require separate packaging and policy review; do not assume direct-download artifacts meet store requirements. A marketing site can be added later without moving user conversations to a backend.

## Release pipeline

When implementation starts, pin frontend and Rust dependencies with lockfiles and pin CI actions to reviewed revisions. Run unprivileged checks on pull requests, including forks. Release credentials are available only to the protected release workflow, never to untrusted PR code.

A tagged release builds target-specific artifacts, records dependency/model metadata, signs native binaries, notarizes macOS packages, produces updater signatures, and creates a draft GitHub release. Check the actual downloaded artifacts on clean devices before publication. Retain checksums, release notes, a dependency inventory, and a migration compatibility declaration.

App-update signatures are separate from Apple or Windows code signing. Tauri's updater supports signed artifacts and static manifests, which fit GitHub Releases. Keep its private signing key out of the repository and plan rotation while the prior trust key is still usable. See the [Tauri updater documentation](https://v2.tauri.app/plugin/updater/).

Check for updates only when the user chooses or enables checks. Install after a session ends, with user control over restart. Never interrupt an active conversation or silently fetch a new model. Policy changes ship with versioned, signed releases and trigger the relevant evaluation suite.

Before schema migration, create a verified encrypted backup. Migrations are transactional where supported and recover after interruption. An older app must refuse to open a newer unsupported schema. Prefer a forward fix; rollback requires a compatible database or restoring the pre-migration backup. Do not advertise unconditional one-click rollback.

Uninstall preserves the vault by default and tells the user where it remains. A separate explicit data-deletion action removes the vault and key material. Test update, downgrade refusal, reinstall, and uninstall with encrypted user data present.

## Verification plan

| Layer | Targeted verification |
| --- | --- |
| Core | State transitions, token budgeting, graph invariants, idempotency, source revisions, recurrence, migration recovery |
| Storage | Wrong keys, corrupted data, encrypted WAL/temp behavior, interrupted key rotation, backup restore across OSes |
| Providers | Stream frame splitting, missing features, empty/malformed output, timeout, cancellation, HTTP errors, configuration/consent changes |
| Network privacy | Local mode traffic capture, runtime cloud setting, redirects, endpoint changes, secret redaction |
| UI | Onboarding, send/stop/retry, history, corrections, deletion confirmation, memory-off state, lock, empty/error/loading states |
| Accessibility | Keyboard-only use, visible focus, VoiceOver, NVDA, zoom, reduced motion, text contrast, narration of accepted responses |
| Native app | Key store, file dialogs, notifications, tray behavior, sleep/wake, timezone changes, signed installer, update and uninstall |
| Behavior | Human-reviewed synthetic conversations, memory quality, high-risk cases, long conversations, prompt injection |

Browser tests with a mocked native bridge verify UI behavior. They do not prove native key storage, database encryption, or installer correctness. Check Tauri's current automation support before choosing native tooling, and retain real macOS and Windows smoke testing. No development server should be started without the owner's explicit request; check for an existing one before visual QA.

## Performance experiments

These are prototype targets, not advertised guarantees. Record OS, CPU/GPU, RAM, model digest, quantization, context length, and warm/cold status with every run.

- Aim for a usable unlocked shell within 2 seconds on the reference machine, excluding passphrase work and model loading.
- Aim for p95 memory retrieval under 150 ms with 10,000 synthetic nodes on the reference machine.
- Measure warm and cold generation, time to first provider token, time to first accepted visible response, and tokens per second separately. Buffered output checking changes visible latency.
- Initial usability target is an accepted short response within 15 seconds when warm on a 16 GB Apple Silicon reference machine and a documented Windows 11 x64 reference machine. Choose the Windows GPU/CPU configuration before comparison. If missed, adjust model, response length, or scope based on evidence.
- Target visible stop feedback within 100 ms. Confirm provider-stream cancellation and separately measure when local GPU work actually stops; do not claim they are identical.
- Target no inference while locked and near-zero background CPU while idle. Measure shell memory separately from the multi-GB model process.

## Release gates and ownership

Krish owns product scope, visual direction, license, and release approval. Engineering owns integrity, packaging, and measurable acceptance checks. A qualified mental-health reviewer owns review of the conversation rubric and known behavior failures; an independent security reviewer assesses the sensitive boundaries. Those reviewers have not been assigned.

Before public beta, resolve launch jurisdiction, verify resources, complete threat-model review, demonstrate correction and deletion, restore a portable encrypted backup, test signed upgrades, review accessibility on both OSes, and publish accurate model/privacy limitations. Passing a fixed evaluation suite is evidence about that suite, not proof of clinical effectiveness.

The next implementation task, once requested, should be the narrow native feasibility prototype in stage 1.
