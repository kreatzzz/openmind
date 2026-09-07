# Desktop engineering preview

The first implementation is a single-user desktop foundation. It is not an evaluated clinical product. Use synthetic conversations while developing it.

## Implemented

- Tauri 2 shell, React conversation interface, local bundled fonts, responsive navigation and keyboard-accessible dialogs.
- Passphrase creation and unlock, encrypted sessions and messages, explicit lock, and interrupted-reply recovery.
- A random 32-byte SQLCipher database key, wrapped using Argon2id and XChaCha20Poly1305. The authenticated envelope fixes and bounds KDF parameters. A vault file lock prevents two app processes from opening it simultaneously.
- Ollama model discovery and streaming over an explicitly configured HTTP loopback endpoint. The adapter rejects redirects, proxies, non-loopback hosts, and recognized cloud model metadata. The runtime remains a separate trust boundary.
- One active generation, stop control, persistence before displaying chunks, and rejection of late writes after locking.
- At most 20 recent messages and 6,000 UTF-8 bytes of conversation context. Each request asks for an 8,192-token context and at most 1,024 output tokens. These are conservative prototype limits, not validated budgets for every model or tokenizer.

The browser view offers a clearly labeled synthetic sample. Native vault and inference operations require the desktop shell. Connection and reading preferences currently last only for the open app instance.

## Not implemented

Internal memory, generated user notes, note editing, correction and deletion controls, summaries, remote APIs, speech input/output, reminders, keychain convenience unlock, OS lock/suspend handling, automatic idle lock, encrypted backup/export, migrations beyond schema version 1, and signed updates are future work.

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

An ignored provider smoke test can connect to a separately started Ollama instance:

```sh
OPENMIND_TEST_OLLAMA_URL=http://127.0.0.1:11439 \
OPENMIND_TEST_MODEL=gemma3:270m \
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features live_ -- --ignored
```

This verifies the protocol using a synthetic prompt. It does not assess therapeutic behavior.
