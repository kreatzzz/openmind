# ChatGPT subscription testing bridge

This adapter connects native Openmind workspaces to a locally installed Codex CLI using the official [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server). Codex manages [ChatGPT sign-in and subscription access](https://learn.chatgpt.com/docs/auth). Openmind does not read browser cookies or implement its own token refresh flow.

## Test access

1. Install the official Codex CLI and run `codex login` with the ChatGPT subscription you want to test. `codex login status` should report ChatGPT access.
2. Create or unlock your normal encrypted workspace in the desktop app.
3. In **Settings → Model connection**, choose **ChatGPT**, then load and select an available model.
4. Read and enable the remote-processing consent checkbox, then save and check the connection. A completed reply is followed by a separate structured-notes request.

The app uses the existing Codex login. It does not create a separate Openmind account. This adapter requires subscription sign-in; it does not silently switch to API-key billing.

## Data handling

The bridge process runs locally, but model inference runs on OpenAI's servers. Reply requests send bounded conversation history and retrieved memories. The notes request sends the current user message as source material. Subscription limits and the account's applicable data policies still apply.

The UI starts with consent unchecked. Rust checks consent before creating a remote turn or notes job. Provider configuration and consent are persisted in the active encrypted vault. Changing the provider, model, credential, or consent revokes queued remote notes snapshots. Locking prevents further requests until unlock. The browser workspace cannot use this adapter because it has no native process bridge.

Openmind saves transcripts, remembered context, and notes in the encrypted local vault. Remote processing still sends the disclosed text to OpenAI when consent is enabled.

## Implementation status

The UI, native consent checks, and child-process adapter are checked in. ChatGPT sign-in, model discovery, live replies, and structured notes have passed synthetic Windows tests through the adapter.

The adapter requests ephemeral threads, uses temporary working/log/state paths, disables tool features, explicitly disables inherited MCP servers, and checks their runtime status before sending source text. Unit tests cover MCP-state rejection, final-message filtering, unexpected tool items, and cancellation before startup. Those tests do not establish isolation across every Codex version.

Live subscription generation now passes through the Rust adapter on Windows, including structured-note validation and the synthetic [conversation quality evaluation](evaluations/conversation-quality-2026-09-22.md). Native UI end-to-end verification and macOS runtime testing remain pending. This is not a completed remote-provider qualification.

The adapter checks the executable version and `app-server --help --stdio` before use. `OPENMIND_CODEX_PATH` can select an absolute executable path. On Windows, discovery checks the official stable location and a bounded set of versioned subdirectories before PATH. Codex `0.155.0-alpha.9.2` passed the live Rust-adapter checks on September 22.

## Next session

Run the opt-in synthetic live test using an available subscription model:

```sh
OPENMIND_TEST_CODEX_MODEL=gpt-5.6-luna \
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features live_codex_reply_and_notes -- --ignored
```

Then verify the native provider selector, consent, reply streaming, notes, and Stop/Lock behavior. Inspect the ephemeral-thread and child-process cleanup behavior before describing the bridge as ready. Native UI verification on Windows and all macOS runtime testing remain outstanding.
