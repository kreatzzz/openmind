# Openmind

A planned desktop app for private, ongoing conversations about life, with locally hosted AI models and memory that carries between sessions.

**Status: architecture and product planning. There is no runnable app yet.**

Openmind is intended to connect life events, people, recurring concerns, and goals in an encrypted memory graph. Users can start a conversation whenever they want or set a reminder for a planned session. Local inference is the default; connecting a remote API is an explicit choice.

The proposed first release is an adult self-reflection and emotional-support app. Clinical therapy positioning remains an open product decision. No clinical effectiveness or therapist-equivalence claim has been established.

## Start here

| Document | Contents |
| --- | --- |
| [Architecture](docs/architecture.md) | Desktop stack, component boundaries, provider integration, session flow, and planned code layout |
| [Memory](docs/memory.md) | Graph schema, evidence, retrieval, corrections, and forgetting |
| [Privacy](docs/privacy.md) | Encryption, key management, trust boundaries, backups, and limits of hidden memory |
| [Conversation policy](docs/conversation-policy.md) | Proposed behavior, crisis handling, and evaluation requirements |
| [Design](DESIGN.md) | Visual identity, design tokens, screens, interaction, and accessibility |
| [Delivery plan](docs/delivery.md) | Milestones, macOS and Windows distribution, verification, and release criteria |
| [Decisions and questions](docs/decisions.md) | Confirmed requirements, recommendations, and unresolved choices |

## Proposed foundation

Tauri 2, Rust, React, TypeScript, Vite, Tailwind CSS, and Bun. SQLite with SQLCipher stores conversations and graph data. Ollama is the first local runtime integration, with a separate OpenAI-compatible adapter for other local servers and remote endpoints.

Encryption protects stored data. Internal memory can be hidden from the normal interface, but cannot be guaranteed secret from the owner of a computer that decrypts and runs it. See the [privacy design](docs/privacy.md).

## Project status

Planning began on September 6, 2026. Recommendations in these documents are proposals, not implemented capabilities. Performance targets and safety criteria still need measurement and review.

Use only synthetic conversations in public issues, examples, and tests. The software license has not been selected yet; public visibility should not be read as a chosen open-source license.
