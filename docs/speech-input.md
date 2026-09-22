# Local speech input

Status: implementation boundary and fail-closed browser capability probe. A consistent native engine is still required before speech input can be considered a supported desktop feature.

## Privacy decision

Therapy dictation can contain health and family information. Openmind must never switch from local transcription to a cloud recognizer because a local model is missing, slow, or unsupported. Recording starts only after a direct user action, stays visibly active, and produces an editable draft. It never submits a message automatically.

The ordinary Web Speech API is not an acceptable default. Microsoft documents that Edge's standard implementation sends captured audio to Azure Cognitive Services. Edge now has an experimental local model selected with `processLocally = true`, but the current documentation requires a recent Dev or Canary build and a feature flag. WebView2 does not document this as a stable embedded-runtime contract. WebKit supports speech recognition, but its web API does not provide a dependable cross-platform local-only contract for a Tauri release. Apple's native Speech framework can enforce local processing with `requiresOnDeviceRecognition`, but only when the recognizer reports `supportsOnDeviceRecognition`.

The frontend module at `src/lib/localSpeechRecognition.ts` therefore accepts only the unprefixed API with `SpeechRecognition.available()` and requests `processLocally: true` on both the availability check and recognition instance. It rejects the older prefixed API, never falls back to remote recognition, and downloads a language pack only through a separate explicit operation. This provides a safe progressive path on a runtime that proves support; it is not the release backend.

Primary references:

- [Microsoft Edge local speech recognition](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/speech-recognition-api)
- [Microsoft Edge SpeechRecognition policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/speechrecognitionenabled)
- [Web Speech API specification](https://webaudio.github.io/web-speech-api/)
- [Apple `requiresOnDeviceRecognition`](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
- [Apple `supportsOnDeviceRecognition`](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)

## Production backend

Use one Rust-owned local transcription boundary on Windows and macOS:

1. Capture microphone audio in the native process, not the webview. Convert it in memory to 16 kHz mono PCM and retain only a short bounded buffer.
2. Transcribe with an in-process whisper.cpp binding. Do not write raw audio to a temporary file. Keep CPU inference as the compatibility baseline; add platform acceleration only after packaging tests.
3. Provision a pinned model through an explicit setup action. Show its download size, source, license, and local storage location; verify a committed SHA-256 digest before activation. A model download contains no user audio.
4. Stream typed `listening`, `partial`, `final`, `error`, and `ended` events over a narrow Tauri channel. Keep raw audio and model handles out of renderer IPC.
5. Expose idempotent `start`, `stop`, and `cancel` commands. Lock, quit, renderer loss, and conversation changes must cancel capture and clear buffers. `stop` may finalize the current draft; `cancel` must discard it.
6. Insert final text into the composer as an editable draft. Preserve text that was already present and the user's selection. Never call the existing send-message command from speech code.

The native capability response should distinguish `ready`, `model_missing`, `permission_denied`, `microphone_unavailable`, `unsupported_hardware`, and `busy`. Error messages must not include recognized text. Logging may include durations and error codes locally, but no audio, transcript fragments, or content-derived telemetry.

## Release gates

- Verify the packaged Windows and macOS applications request microphone access only when the user starts dictation.
- Confirm no network traffic occurs while recording or transcribing after the model has been installed.
- Test cancel, lock, quit, suspend, device removal, permission revocation, silence, and a renderer crash.
- Measure real-time factor and peak combined ASR/model memory on the supported hardware floor.
- Evaluate names, negation, medication terms, pauses, accents, background noise, and distress speech with consented or synthetic recordings. The draft must remain clearly editable because transcription errors can reverse meaning.
- Run keyboard, screen-reader, 200% zoom, reduced-motion, and visible-recording-state checks on both native webviews.

Until those gates pass, the voice control should report local speech as unavailable rather than route audio elsewhere.
