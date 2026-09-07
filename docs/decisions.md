# Decisions and questions

Planning began September 6, 2026; requirements updated September 7, 2026. A desktop engineering preview now exercises the shell, encrypted vault, and Ollama streaming. See [prototype status](prototype.md) for the implemented subset and its limitations.

## Confirmed requirements

- Public repository named Openmind, with architecture planning before implementation.
- Desktop distribution for macOS and Windows.
- Conversations about personal life with continuity between visits.
- Support for locally hosted models and configurable model APIs.
- An Obsidian-like network of memories maintained by the AI.
- Encrypted internal notes, with the intended degree of user access still to resolve.
- Planned sessions and conversations started at any time.
- A polished, distinctive interface.
- Clinical therapy is the intended product scope. Specific indications and clinical delivery model remain open.
- Streamed text responses from the model at launch; text-to-speech output comes later, with ElevenLabs as an example provider.
- Three results from submitted input: updated encrypted internal notes, a response, and updated notes for the user. Execution order and optimization are delegated to architecture design.

## Proposed decisions

| Decision | Recommendation | Reason and consequence |
| --- | --- | --- |
| Clinical delivery | Define target condition, population, intervention, and independent versus clinician-supported use | Clinical intent is confirmed; effectiveness, oversight, and release authorization are not established |
| Desktop foundation | Tauri 2 with Rust and a React/Vite UI | Native storage and OS integration with web UI development; requires testing both system webviews |
| Local runtime | Connect to an existing Ollama installation first | Avoid managing GPU drivers, binaries, and multi-GB downloads before the conversation experience works |
| Other providers | Separate OpenAI-compatible adapter | Broad interoperability without assuming every server implements the same features |
| Storage | One SQLCipher database per local profile | Transactions across chat, graph, search, and deletion without a graph service |
| Internal memory | Hide raw graph in normal UI; expose useful remembered facts and controls | User can correct or delete information without navigating internal inference records |
| Identity | One local profile; no account or authentication service | Offline use and no account backend; additional profiles can come later |
| Input | Typing plus local speech-to-text, pending clarification | Interpret "switch to text" as speech-to-text; transcriptions become editable drafts before submission |
| Turn execution | Stream a reply, then run one structured call for both note sets | Two main model calls, bounded work, no wait for note generation before replying |
| User notes | A separate editable notebook with source-linked takeaways and agreed next steps | Different content and access rules from internal memory; both encrypted at rest |
| Language | English for the first evaluated release | Other languages require their own behavioral and resource evaluations |
| Distribution | Direct signed downloads first | GitHub Releases for installers and update artifacts; stores evaluated later |
| Cloud infrastructure | None for conversation processing | Only public distribution assets; BYOK providers receive data directly when enabled |
| License | Unselected | Do not grant a license on the owner's behalf during planning |

## Clarifications and remaining questions

Krish confirmed clinical therapy on September 7. The old adult self-reflection positioning is superseded. Adults remain the proposed initial population, not a confirmed age requirement. Clinical delivery might be independent or clinician-supported; the question has been raised and remains open.

The input phrase "text and switch to text" is interpreted as typing and speech-to-text. Confirmation has been requested. Streamed text output and later text-to-speech are explicit requirements. Local speech recognition is the proposed default; ElevenLabs is a later output-provider candidate, not a requirement to send microphone audio to a cloud service.

The memory question was unclear to Krish, so the access decision remains open. In plain language: encryption can protect copied files and hide internal notes from ordinary app use, but someone controlling the computer can inspect the decrypted information used by the model. The current recommendation is hidden internal notes plus separate user notes and correction/deletion controls. This explanation does not constitute user approval of the access policy.

If secrecy from the device owner is essential, it conflicts with the fully local design. A remote trusted service changes privacy and offline behavior; hardware isolation needs a separate threat analysis and does not prevent model-output leakage.

## Questions for the next planning conversation

| Question | Why it matters | Working assumption |
| --- | --- | --- |
| Which countries and languages launch first? | Behavioral review, resource directories, privacy obligations, and product claims vary | English prototype; launch territory unselected |
| Which condition, treatment approach, population, and delivery model come first? | A broad "AI therapist" does not define an evaluable clinical intended use | Adult prototype proposed; indications and clinician involvement unselected |
| What hardware should feel good? | Model size and context depend on RAM, GPU, and acceptable latency | Benchmark 16 GB Apple Silicon and Windows 11 x64; no minimum promised yet |
| Should users install Ollama themselves? | Technical users can do this; general consumers may need a managed runtime | Guided connection for the prototype; validate onboarding before beta |
| Which APIs matter first? | Compatibility testing must use actual endpoint implementations | Ollama plus one chosen compatible endpoint |
| Is a separate vault passphrase acceptable? | Protects against casual access on a shared OS account but adds unlock friction | Passphrase default; optional OS-assisted convenience unlock |
| How much transcript history should be kept? | Long-term recall, deletion, storage, and user expectations | Persist until deleted; private sessions are available; retention controls included before beta |
| What should close-window do? | Reminder reliability and battery use depend on background behavior | Explicit quit or tray choice, with no inference while locked |
| What commercial and license model is intended? | Distribution rights, contributions, and possible future paid features | Public plans, license undecided, no billing architecture |
| Is clinical leadership available? | Treatment design, evidence, participant protections, and release decisions require appropriate expertise | Required before clinical deployment; no clinical lead has been engaged |

## Alternatives and reasons

- Electron remains a fallback if Tauri's native dependencies or webview behavior block required UX. Its bundled Chromium gives more consistent rendering, at the cost of another runtime and a different security setup. Test Tauri early instead of committing before packaging works.
- A bundled llama.cpp runtime could improve first-run onboarding later. It adds process lifecycle, hardware builds, model distribution, and license obligations. The adapter boundary keeps that option open.
- A web app does not meet the same native storage, keychain, and offline runtime integration requirements without a companion service.
- Neo4j, a separate vector database, Python services, and a general agent framework are unnecessary for the first single-user app. Add infrastructure only after a measured problem justifies it.
- MCP integrations, browsing, plugins, multi-agent orchestration, autonomous overnight analysis, sync, and clinician dashboards are outside v1. Internal memory needs bounded operations, not arbitrary tool execution.
