# Engineering readiness

Updated September 22, 2026. This page separates working software from the work still required for a dependable desktop release. Clinical release has additional requirements and is not implied by engineering completion.

## Current baseline

The app has a native Tauri shell, encrypted SQLCipher vault, streamed conversations, a durable notes queue, source-backed remembered context, lexical and optional local-vector retrieval, correction and forgetting, private sessions, encrypted backup and restore, provider consent, planned sessions, themes, reading controls, and Windows/macOS packaging checks.

The memory evaluation uses invented histories. Deterministic retrieval passes its fixed cases, while the first live embedding evaluation retrieved the intended record for 16 of 18 questions and returned an irrelevant semantic result for one of two unknown questions. That model is therefore not a qualified default. The local chat model now extracts straightforward preferences and goals but still misses a corrected preference embedded in sarcasm. See the [full evaluation](evaluations/memory-quality-2026-09-16.md).

## Work remaining

| Priority | Area | Completion condition |
| --- | --- | --- |
| P0 | Clinical definition and evidence | Select the intended population, use, intervention, jurisdiction, and oversight model with qualified clinical leadership. Run versioned behavior and safety evaluations for the exact model configuration. |
| P1 | Memory quality | Evaluate at least 100 held-out continuity questions and 200 reviewed extraction candidates. Calibrate one supported embedding model, measure abstention and identity confusion, and cover conflicting dates, corrections, sarcasm, multilingual input, and retrieved prompt injection. |
| P1 | Provider qualification | Qualify one local chat model, one embedding model, and one chosen compatible endpoint. Test streaming and structured extraction separately. Keep reachability distinct from demonstrated chat or memory quality. |
| P1 | Native privacy lifecycle | Add a supported signal for ordinary macOS screen lock, make native monitor failure visible and fail closed, and complete physical lock, disconnect, suspend, and resume checks on Windows and macOS. |
| P1 | Signed desktop release | Configure the protected release environment and signing credentials. Produce a signed draft, then test clean install, launch, upgrade, downgrade refusal, uninstall, and vault preservation on physical devices. |
| P1 | Native accessibility | Complete keyboard, focus, 200% native zoom, VoiceOver, NVDA, file-dialog, notification-permission, and minimum-OS checks. Browser checks do not cover native webviews or assistive technology. |
| P2 | Large-history UI | Add measured pagination or virtualization for very long transcripts and session lists. Preserve source-message navigation, scroll anchoring, streaming, and screen-reader order. |
| P2 | Updates and background behavior | Choose close-window and reminder behavior. Add a signed updater only after an HTTPS manifest, protected updater keys, migration checks, and a rule that updates never interrupt an active conversation. |
| P2 | Product scope | Decide speech input, transcript editing, relationship reconciliation, supported hardware, languages, license, and account/keychain convenience. Each accepted feature needs its own privacy and failure behavior. |

## Changes in this hardening pass

- Streaming text is applied at most once per animation frame, and unchanged transcript rows are memoized. Terminal events flush queued text before status changes. Stop is idempotent and visibly pending.
- Settings has a fixed header and footer with a scrollable body, so its primary action remains visible on compact windows. A production-build browser check covers onboarding, notes, memory controls, focus return, themes, narrow layouts, and a 200%-zoom-equivalent viewport without a development server.
- Embedding maintenance skips model discovery when no records need work. A point eligibility query replaces repeated batch materialization while preserving the final transactional revision check. On 256 synthetic sources, this database validation step changed from 325,575 µs to 16,964 µs across three rounds, about 19.2 times faster; model inference was excluded.
- Renderer reconnect now cancels registered memory work. Provider streams reject token-limit, content-filter, tool-call, and unknown terminal reasons instead of saving a partial reply as complete.
- Provider health verifies that the selected model exists. Ollama rejects a model whose declared capabilities omit text completion; older runtimes remain unknown rather than guessed. Compatible endpoints must return the selected model in a bounded model inventory. Reachability no longer claims that streaming or structured memory quality has been proven.
- CI caches pinned Rust dependencies, retains both desktop test jobs, adds timeouts, and runs the production browser check. Native bundle jobs keep clean-runner install and packaging coverage.

These optimizations do not change the evidence, correction, deletion, consent, or encrypted-storage boundaries. The embedding benchmark measures database selection only and should not be presented as end-to-end response latency.
