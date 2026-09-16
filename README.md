# Openmind

A desktop app in development for private, ongoing conversations about life, with locally hosted AI models and memory that carries between sessions.

**Status: desktop engineering preview. Not evaluated clinical care.**

The current implementation includes a Geist-inspired desktop UI, a separate one-click demo, an encrypted conversation vault, Ollama streaming, source-linked editable notes, and a Remembered context workspace with correction and forgetting controls. Each conversation can be renamed and has independent switches for remembered context and notebook saving. A structured follow-up call saves user notes and internal memory together. Relationship mapping and the full clinical workflow remain in development. See [prototype capabilities, limitations, and setup](docs/prototype.md).

Openmind is intended to connect life events, people, recurring concerns, and goals in an encrypted memory graph. Users can start a conversation whenever they want or set a reminder for a planned session. Local inference is the default; connecting a remote API is an explicit choice.

The intended product is a clinical therapy app. Target conditions, clinical delivery model, launch jurisdiction, and evidence requirements still need definition. No clinical effectiveness or therapist-equivalence claim has been established.

Each submitted message should lead to a streamed text reply, an update to encrypted internal memory, and an update to separate user-facing notes. The proposed launch input is typing plus local speech-to-text, pending clarification. Text-to-speech output, with a provider such as ElevenLabs, comes later.

## Try the demo

Run `bun run tauri dev` and choose **Open demo**. The public test login is `demo`, with password `openmind-demo-2026`; the button enters them automatically. The demo uses a separate vault containing fictional conversations. No personal account setup is required. See [Linux launch troubleshooting](docs/prototype.md#linux-startup-troubleshooting) if the desktop window fails to open.

## Start here

| Document | Contents |
| --- | --- |
| [Architecture](docs/architecture.md) | Desktop stack, component boundaries, provider integration, session flow, and planned code layout |
| [Turn processing](docs/turn-processing.md) | Two model calls for three results, text streaming, note updates, recovery, and speech input |
| [Memory](docs/memory.md) | Graph schema, evidence, retrieval, corrections, and forgetting |
| [Privacy](docs/privacy.md) | Encryption, key management, trust boundaries, backups, and limits of hidden memory |
| [Conversation policy](docs/conversation-policy.md) | Proposed behavior, crisis handling, and evaluation requirements |
| [Design](DESIGN.md) | Visual identity, design tokens, screens, interaction, and accessibility |
| [Delivery plan](docs/delivery.md) | Milestones, macOS and Windows distribution, verification, and release criteria |
| [Decisions and questions](docs/decisions.md) | Confirmed requirements, recommendations, and unresolved choices |

## Foundation

Tauri 2, Rust, React, TypeScript, Vite, Tailwind CSS, and Bun. SQLite with SQLCipher stores conversations and graph data. Ollama is the first local runtime integration, with a separate OpenAI-compatible adapter planned for other local servers and remote endpoints.

Encryption protects stored data. Internal memory can be hidden from the normal interface, but cannot be guaranteed secret from the owner of a computer that decrypts and runs it. See the [privacy design](docs/privacy.md).

## Project status

Planning began on September 6, 2026; the desktop foundation followed on September 7. Architecture documents describe the full proposed product. The [prototype status](docs/prototype.md) distinguishes working code from remaining work. Performance targets and clinical safety criteria still need measurement and review.

Open-source distribution does not settle the legal obligations of a clinical app. See the [legal considerations](docs/legal-considerations.md).

Use only synthetic conversations in public issues, examples, and tests. The software license has not been selected yet; public visibility should not be read as a chosen open-source license.

The experimental [ChatGPT subscription testing bridge](docs/codex-testing.md) is checked in as a work-in-progress checkpoint. Live adapter verification remains pending.

## Contributing

Use a feature branch and open a pull request. The [main branch ruleset](https://github.com/kreatzzz/openmind/rules/23013849) blocks direct pushes, force pushes, and deletion, requires passing macOS and Windows desktop checks, and has no bypass actors. See [contributor instructions](AGENTS.md).
