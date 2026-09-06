# Decisions and questions

Planning baseline: September 6, 2026. No implementation decisions below have been validated by a running prototype.

## Confirmed requirements

- Public repository named Openmind, with architecture planning before implementation.
- Desktop distribution for macOS and Windows.
- Conversations about personal life with continuity between visits.
- Support for locally hosted models and configurable model APIs.
- An Obsidian-like network of memories maintained by the AI.
- Encrypted internal notes, with the intended degree of user access still to resolve.
- Planned sessions and conversations started at any time.
- A polished, distinctive interface.

## Proposed decisions

| Decision | Recommendation | Reason and consequence |
| --- | --- | --- |
| Product scope | Adult emotional support and self-reflection for v1 | Requires honest capability limits and behavioral review; clinical therapy would need a different evidence and release process |
| Desktop foundation | Tauri 2 with Rust and a React/Vite UI | Native storage and OS integration with web UI development; requires testing both system webviews |
| Local runtime | Connect to an existing Ollama installation first | Avoid managing GPU drivers, binaries, and multi-GB downloads before the conversation experience works |
| Other providers | Separate OpenAI-compatible adapter | Broad interoperability without assuming every server implements the same features |
| Storage | One SQLCipher database per local profile | Transactions across chat, graph, search, and deletion without a graph service |
| Internal memory | Hide raw graph in normal UI; expose useful remembered facts and controls | User can correct or delete information without navigating internal inference records |
| Identity | One local profile; no account or authentication service | Offline use and no account backend; additional profiles can come later |
| Input | Text first | Makes privacy, memory accuracy, and conversation behavior testable before adding audio latency |
| Language | English for the first evaluated release | Other languages require their own behavioral and resource evaluations |
| Distribution | Direct signed downloads first | GitHub Releases for installers and update artifacts; stores evaluated later |
| Cloud infrastructure | None for conversation processing | Only public distribution assets; BYOK providers receive data directly when enabled |
| License | Unselected | Do not grant a license on the owner's behalf during planning |

## Questions already raised with Krish

1. Is v1 an adult self-reflection and support app, or a clinical therapy product?
2. Is hiding the graph from ordinary use sufficient, with correction and deletion controls, or is secrecy from the device owner essential?
3. Is text sufficient for v1, or must voice ship alongside it?

The current documents use the first option in each question as a planning assumption. Silence does not mean those choices were approved.

If clinical therapy is the goal, retain the technical foundation but revise intended use, clinical oversight, evidence collection, regulatory assessment, and launch criteria before implementation. If strict model-only secrecy is essential, the fully local requirement conflicts with it. A remote trusted service changes privacy and offline behavior; hardware isolation still needs a separate threat analysis and does not prevent model-output leakage.

If voice is essential, move the audio workstream into the first release, including transcription accuracy, local speech synthesis, interruption, microphone permissions, and audio retention. It is not merely a microphone button.

## Questions for the next planning conversation

| Question | Why it matters | Working assumption |
| --- | --- | --- |
| Which countries and languages launch first? | Behavioral review, resource directories, privacy obligations, and product claims vary | English prototype; launch territory unselected |
| What hardware should feel good? | Model size and context depend on RAM, GPU, and acceptable latency | Benchmark 16 GB Apple Silicon and Windows 11 x64; no minimum promised yet |
| Should users install Ollama themselves? | Technical users can do this; general consumers may need a managed runtime | Guided connection for the prototype; validate onboarding before beta |
| Which APIs matter first? | Compatibility testing must use actual endpoint implementations | Ollama plus one chosen compatible endpoint |
| Is a separate vault passphrase acceptable? | Protects against casual access on a shared OS account but adds unlock friction | Passphrase default; optional OS-assisted convenience unlock |
| How much transcript history should be kept? | Long-term recall, deletion, storage, and user expectations | Persist until deleted; private sessions are available; retention controls included before beta |
| What should close-window do? | Reminder reliability and battery use depend on background behavior | Explicit quit or tray choice, with no inference while locked |
| What commercial and license model is intended? | Distribution rights, contributions, and possible future paid features | Public plans, license undecided, no billing architecture |
| Is clinician review available? | Conversation policy and launch evaluations need domain review | Required before public emotional-support beta; no reviewer has been engaged |

## Alternatives and reasons

- Electron remains a fallback if Tauri's native dependencies or webview behavior block required UX. Its bundled Chromium gives more consistent rendering, at the cost of another runtime and a different security setup. Test Tauri early instead of committing before packaging works.
- A bundled llama.cpp runtime could improve first-run onboarding later. It adds process lifecycle, hardware builds, model distribution, and license obligations. The adapter boundary keeps that option open.
- A web app does not meet the same native storage, keychain, and offline runtime integration requirements without a companion service.
- Neo4j, a separate vector database, Python services, and a general agent framework are unnecessary for the first single-user app. Add infrastructure only after a measured problem justifies it.
- MCP integrations, browsing, plugins, multi-agent orchestration, autonomous overnight analysis, sync, and clinician dashboards are outside v1. Internal memory needs bounded operations, not arbitrary tool execution.
