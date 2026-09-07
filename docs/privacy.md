# Privacy and security design

Status: proposed threat model and controls. Nothing in this document describes implemented or audited encryption.

## The model-only memory constraint

A fully local application cannot guarantee that its stored memories are inaccessible to the owner of the device. The backend must decrypt relevant memories and pass their plaintext to inference. An administrator can inspect processes, instrument the runtime, modify the application, or ask the model questions that reveal supplied context. Public source makes this especially clear, but closing the source would not fix the underlying boundary.

The achievable promise is encrypted storage, a restricted application interface, and no raw graph browser in normal use. It is not permanent secrecy from the user. Even hiding raw graph commands does not guarantee that model responses will never disclose a supplied note. Do not use prompts as an access-control mechanism.

Recommended wording is "Your conversations and internal memory are encrypted on this device. Openmind unlocks relevant information to generate replies." Remote mode needs an additional statement that selected information is sent to the chosen provider.

User-facing notes are separate records with the same at-rest encryption. Hiding the internal graph does not make it a legally privileged or exempt clinical record. Access, correction, retention, and deletion requirements need jurisdiction-specific review for the intended clinical use.

If secrecy from the device owner is essential, revisit the product requirements. A trusted remote service or hardware-backed execution design changes the trust model, costs, offline access, and recovery story. Neither should be promised as a simple fix, particularly because output leakage still exists.

## Threats and limits

| Threat | Proposed protection | Residual limit |
| --- | --- | --- |
| Stolen powered-off device or copied vault | SQLCipher plus separately wrapped random vault key | Weak passphrases, copied unlock material, or an already unlocked OS account change exposure |
| Casual access on a shared machine | Passphrase unlock, app lock, neutral notifications, clear recent content | Does not defeat an administrator or malware |
| Malicious model output or prompt injection | Narrow operations, schema validation, no arbitrary tools, sanitized rendering | Can still mislead a user or cause poor suggestions; requires behavior evaluation |
| Compromised webview | Restricted native commands, no direct provider networking, CSP | Displayed conversations are present in frontend memory while unlocked |
| Malicious local model server | Explicit trust disclosure and tested configuration | Server sees plaintext and Openmind cannot fully police an independently managed process |
| Remote provider retention | Explicit consent, minimal context, no automatic fallback | Provider policies and logs are outside local deletion guarantees |
| Malicious update | Artifact signatures, native code signing, protected release workflow | Compromised signing keys or trusted build dependencies remain risks |
| Accidental diagnostic disclosure | No content logging, no automatic crash uploads, synthetic fixtures | OS crash reporting and user-created screenshots can retain information |

## Vault and keys

Generate a random 256-bit data-encryption key per profile using the operating system CSPRNG. Use it with a maintained SQLCipher build. Do not implement a custom page-encryption layer. SQLCipher encrypts database pages and journal page data, including WAL page data; it does not encrypt every form of process metadata or arbitrary files. See [SQLCipher's design](https://www.zetetic.net/sqlcipher/design/).

Wrap the vault key with a passphrase-derived key using an audited authenticated-encryption implementation. Derive the wrapping key with Argon2id and a random salt. Store an envelope version, salt, KDF parameters, nonce, and wrapped key outside the database so unlocking can occur. Authenticate envelope metadata and bound untrusted KDF parameters before allocation. Use [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) as the parameter reference, then benchmark an appropriate memory and time cost on supported hardware. Never use a fast password hash as a substitute.

The default requires the vault passphrase on app unlock. Optional convenience unlock stores device unlock material in macOS Keychain or Windows current-user protected secret storage. This mode is weaker against someone operating the same unlocked OS account. A separate app passphrase offers no extra protection if a silently accessible stored key bypasses it.

Apple provides [Keychain services](https://developer.apple.com/documentation/security/keychain-services). Validate the chosen Rust wrapper, access controls, and Windows backend in the native prototype. Do not claim biometrics, Secure Enclave binding, or protection from same-user malware merely because a key store API is used.

Offer an optional generated recovery secret with its own key-wrapping envelope, shown once and confirmed before dismissing. No developer-held recovery copy. Losing the passphrase and all recovery/unlock material means losing the vault. Changing a passphrase rewraps the vault key atomically; a recovery compromise requires rotating the underlying key and updating all envelopes.

Provider secrets live in the vault or native secret store as opaque references. They never enter browser localStorage, persisted React state, debug logs, command-line arguments, or error reports.

## Locked state

Lock on explicit request, OS session lock, and configurable idle timeout. Suspend handling cancels inference before releasing application-held keys where practical. Zeroize key buffers with supported library facilities, close the database, discard retrieved context, remove frontend conversation state, and cancel background jobs. Avoid claiming perfect erasure of every runtime copy, GPU allocation, or swap page.

Do not stop a user's independently managed Ollama service or other applications. An eventual app-managed runtime can be unloaded on lock under its own lifecycle policy. In the current proposal, runtime memory retention is a documented limit.

Keep content out of window titles, tray labels, dock previews where controllable, and notification bodies. Copy and export are explicit actions. Prevent remote images and embedded content from loading through rendered model output, because even an image URL can leak information.

## Native and network boundaries

- Bundle UI assets, fonts, icons, and guidance with the app. No CDN dependencies or remote web pages inside a privileged webview.
- Use a restrictive CSP and disable raw HTML in conversation Markdown. Allow external links only through a checked OS-open operation after user action.
- Explicitly restrict custom Tauri commands as well as plugin permissions. Capabilities are not a substitute for validating arguments and current vault state.
- Keep provider HTTP in Rust. Limit requests to configured endpoint origins and intended API paths. Reject arbitrary URL requests from model output.
- Reject redirects by default to prevent credentials or context from moving to another host. Require HTTPS for remote endpoints. Loopback HTTP is only for explicitly trusted local runtimes.
- Avoid treating hostnames as proof of locality. Resolve and validate loopback connections consistently; test IPv4, IPv6, DNS changes, and redirects. Do not forward a provider's credentials to another endpoint.
- Updates and model downloads disclose normal network metadata such as IP addresses. Keep them separate from local-only conversations and explain their destinations.

The implementation should follow [Tauri's security guidance](https://v2.tauri.app/security/) and verify each control in integration tests. A dependency choice does not make these controls automatic.

## Speech and user-note boundaries

Local dictation is the proposed launch input. Start recording only on user action and stop on cancel, timeout, lock, or device loss. Keep raw audio transient, bound its size, and disable content logging and plaintext temporary audio files. Only a user-submitted transcription becomes durable conversation evidence. OS dictation is not presumed offline; an explicit local speech adapter is the default proposal.

Future ElevenLabs output sends response text to a remote speech processor even when the chat model is local. Consent is separate from model-provider consent. Send only text approved for display, never the internal graph or whole notebook. Check provider retention and account terms at integration time; do not promise zero retention by default. See [speech data flow](turn-processing.md#text-to-speech-later).

The paired note writer receives visible source messages and bounded reconciliation references. The public patch may not quote or summarize private graph hypotheses. Validate source support and disclosure behavior before publishing it to the notebook; separate output fields alone do not establish isolation. Encrypted internal notes can still influence model replies, so absolute non-disclosure is not a supported promise.

## Storage, backup, and deletion

Use OS application-data locations outside the source checkout. Exclude vault content from app-created diagnostic bundles. Disable plaintext SQL trace logs, configure temporary SQL storage to memory, and test main database, journal, WAL, temporary files, and recovery paths with known synthetic marker strings. Include full-text tables and optional vector data in those tests.

Create backups through a consistent database snapshot operation into a separately encrypted destination. Do not copy a live database file and assume it contains the WAL state. A portable `.openmind` backup includes an authenticated manifest, schema version, encrypted database snapshot, and a key envelope protected by a backup passphrase or recovery secret. Never include only a machine-bound key and call the backup portable.

Restore into a new vault location, authenticate before migration, and leave the original untouched until restore checks pass. Backup creation must succeed without writing an intermediate plaintext database. Verify restoration on a second OS before promising portability.

Deleting a topic cleans active derived records and source references as specified in [memory](memory.md). Deleting the vault removes the database and all known unlock envelopes. Existing backups, provider logs, OS backups, snapshots, and physical storage remnants are outside that operation. Explain these limits at the relevant deletion action. Never overwrite unrelated backups automatically.

## Diagnostics and incident handling

No analytics, session replay, prompt logging, or automatic content-bearing crash uploads in v1. An opt-in diagnostic export contains app version, platform, redacted provider type, timings, and error codes. Show the exact export before the user saves or shares it. Do not upload it automatically.

Before public beta, establish a private vulnerability-reporting channel and an incident-response owner. Public issues must not request real transcripts, keys, or vault files. The plan does not claim HIPAA, GDPR, or other compliance. Launch territory and actual data flows determine the assessment; see [conversation policy](conversation-policy.md).

## Required proof before beta

Test wrong keys, corrupted envelopes, excessive KDF values, interrupted key rotation, lock during inference, stale events after unlock, backup portability, deletion races, remote consent revocation, redirect credential leakage, and malformed model output. Confirm that local conversation tests produce no remote application requests, and separately observe the runtime's traffic.

An independent security review should cover key management, native commands, rendering, update signing, and dependency packaging. The review is a planned release gate; no audit has occurred.
