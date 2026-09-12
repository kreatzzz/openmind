# ChatGPT subscription testing bridge

This development adapter connects the native demo workspace to a locally installed Codex CLI using the official [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server). Codex manages [ChatGPT sign-in and subscription access](https://learn.chatgpt.com/docs/auth). Openmind does not read browser cookies or implement its own token refresh flow.

## Test access

1. Install the official Codex CLI and run `codex login` with the ChatGPT subscription you want to test. `codex login status` should report ChatGPT access.
2. Open the desktop app and choose **Open demo**. The button supplies the public fixture credentials, `demo` / `openmind-demo-2026`.
3. In Settings, choose **ChatGPT via Codex** and check the connection. Select an available model.
4. Read and enable the consent checkbox, then send a fictional message. A completed reply is followed by the separate structured notes request.

The app uses the existing Codex login. It does not create a separate Openmind account. This adapter requires subscription sign-in; it does not silently switch to API-key billing.

## Data handling

The bridge runs locally, but model inference runs on OpenAI's servers. Reply requests send the bounded demo conversation and saved context. The notes request sends the current user message as source material. Subscription limits and the account's applicable data policies still apply.

The UI starts with consent unchecked. Rust checks demo mode and consent before reading content or creating a remote turn or notes job. Switching providers or locking clears the UI consent. Personal vaults and the browser sample cannot use this development adapter.

Openmind continues to save its transcript and notes in the encrypted demo vault. The public demo passphrase is unsuitable for personal information. Use fictional test material only.

## Implementation status

The UI, native consent checks, and first child-process adapter are checked in. A metadata probe of the installed Codex CLI confirmed ChatGPT sign-in and model discovery. That probe is not an end-to-end test of the adapter.

The adapter requests ephemeral threads, uses temporary working/log/state paths, disables tool features, explicitly disables inherited MCP servers, and checks their runtime status before sending source text. Unit tests cover MCP-state rejection, final-message filtering, unexpected tool items, and cancellation before startup. Those tests do not establish isolation across every Codex version.

**Live subscription generation and native end-to-end verification remain pending.** This is today's checkpoint, not a completed remote-provider milestone. The local Ollama workflow remains the verified testing path.

## Next session

Run the opt-in synthetic live test using an available subscription model:

```sh
OPENMIND_TEST_CODEX_MODEL=gpt-5.6-luna \
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features live_codex_reply_and_notes -- --ignored
```

Then verify the native provider selector, consent, reply streaming, notes, and Stop/Lock behavior. Inspect the ephemeral-thread and child-process cleanup behavior before describing the bridge as ready. macOS and Windows runtime testing of Codex remains outstanding.
