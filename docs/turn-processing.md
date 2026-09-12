# Turn processing, notes, and speech

Proposed architecture, September 7, 2026. Krish requires three results from input: internal note updates, a response, and user-facing note updates. This document proposes execution order and optimization. The [desktop preview](prototype.md) now implements the initial reply-then-structured-notes path. The full scheduling, graph reconciliation, and clinical output-review design below remains proposed and unbenchmarked.

## Two calls for three results

Use one model for two bounded calls initially. Call 1 generates the streamed response. Call 2 produces a structured object containing `internal_memory_patch` and `user_notebook_patch`. The same loaded model can do both, avoiding extra resident weights and model-switching costs. Separate faster models are an optimization to benchmark later.

Persist the submitted input immediately, together with pending derivation work. This records the evidence before replying. It does not pretend that semantic graph updates are already complete. Both note sets are updated after the response so the user does not wait for two background writing tasks before seeing any text.

| Result | Content | Access and timing |
| --- | --- | --- |
| Internal memory | Source-linked facts, relationships, goals, and labeled hypotheses | Encrypted vault; hidden from ordinary UI; updated after the response |
| Response | Text addressed to the user | Progressively displayed during call 1 |
| User notebook | Takeaways, topics discussed, explicitly agreed next steps, and questions to revisit | Separate encrypted records; visible, editable, and deletable after call 2 |

Evaluate updates for every submitted turn, but permit empty patches. A greeting does not need a permanent note. Memory-off and private-session preferences override persistence. Three results describe responsibilities, not a requirement to invent new facts on every message.

## Durable execution

1. On submission, create a logical turn ID and commit the text, source revision, consent snapshot, and pending derivation record in one transaction. An editable speech draft does not enter the transcript until the user sends it.
2. Retrieve relevant graph records and recent unprocessed messages. Use a graph revision snapshot and a source sequence watermark, so the response sees current disclosures even if the previous note job is pending.
3. Call 1 streams a short response. Rust assembles bounded sentence-sized units, checks them against the current conversation and released prefix, commits approved units to the encrypted transcript, then emits ordered display events. Internal notes are never mixed into this stream.
4. Complete the response with an explicit terminal state. Store the exact released text, not a reconstructed alternative. Mark policy-stopped, timed-out, and cancelled attempts as interrupted. The transcript must not silently erase a partial reply the user already saw.
5. Call 2 receives allowed source messages, the completed response if available, relevant existing public notes, and bounded source-backed entity identifiers for reconciliation. It outputs both note patches with source IDs and expected record revisions. Do not give it the raw internal hypothesis graph as material for the public notebook.
6. Validate both patches, including evidence references, profile ownership, notebook content checks, and conflict detection. Apply both in one transaction with a job idempotency key and advance the covered-source watermark. If either fails, keep the old notes and report pending or failed status; retry only the derivation work.

Call 2 runs once per completed turn in the normal case. Under rapid input, coalesce pending work over an explicit contiguous source range. Record coverage for every turn and process bounded batches in order. A newer job must never mark older unprocessed sources complete by accident.

Recent raw turns cover ordinary lag. If pending history exceeds the context budget, reduce or pause consolidation backlog with a bounded catch-up step and explain the wait. Never silently omit unprocessed disclosures or exceed the model's context window.

## What goes into user notes

The notebook is a distinct output, not a public copy of the model's internal notes. Its purpose is to help the user remember what was discussed and what they chose to do. Keep paragraphs brief and actions editable.

Every generated note cites visible conversation evidence. An assistant suggestion is recorded as proposed until the user agrees; it must not turn into a claimed user commitment. Internal hypotheses, risk classifications, diagnostic guesses, and hidden reasoning cannot become notebook entries merely because the model generated them.

Example with invented content: a user reports feeling isolated after moving. Internal memory links the move, reduced contact, and a stated goal of reconnecting, with evidence labels. The notebook says "We discussed reconnecting with friends." It adds "Message a friend this week" as an agreed step only if the user agreed.

Use separate schema branches for both patches and validate public content before display. Schema separation is not a semantic privacy proof; a model can still infer or disclose sensitive material. Test leakage and hallucination explicitly. Do not promise that internal interpretations can never appear in a reply.

User edits take precedence over generated updates. Use record revisions and authorship, preserve user-written text, and create a suggestion instead of overwriting a changed note. Correcting a notebook item can optionally update memory through an explicit linked operation. A notebook edit alone must not silently rewrite the original transcript.

## Streaming and interruption

Text streaming is a launch requirement. The proposed implementation releases real generated content in checked increments, without an artificial typewriter animation. Measure both time to first provider token and time to first visible text.

Set maximum buffered characters, timeouts, and total response tokens. A provider that never emits a sentence boundary must not cause unbounded buffering or force an unchecked flush. Stop with a clear retry state when limits are exceeded. Use full-response review for higher-risk or uncertain cases as defined by the clinical policy; show the changed state honestly.

Output checks can use fast local rules and a tested classifier, but are not part of the two main generation-call count. If a separate generative review call is needed, measure and report that extra cost. On one GPU, do not assume that three large models can run concurrently without slowing the reply.

Later text can change the meaning of an earlier sentence. Sentence checks therefore provide weaker whole-response control than full buffering. Once shown, text cannot be undisclosed. Track these failures in the clinical evaluation and stop release of further text when a concern appears; do not claim checking guarantees safety.

Stopping a reply invalidates later chunks. A retry is a new attempt under the same logical turn, with visible interrupted history. Resume from stored event sequence numbers after a renderer reload. If a crash happens after committing a chunk but before display, restore that chunk from the transcript without generating it again. Pending derivation can process the user's committed disclosure even when the response fails, but cannot turn interrupted assistant text into a user action or factual source.

## Queue and conflict rules

- One large-model generation at a time per local profile. Foreground responses have priority; cancel and requeue an unfinished note-generation call when necessary. Do not interrupt a database transaction halfway through.
- Jobs carry message revisions, graph/notebook revisions, policy version, provider configuration, consent snapshot, and a profile privacy epoch.
- Revalidate current consent and privacy epoch before sending a job and before committing results. Changing provider or revoking consent never silently reroutes old work. Requests already sent to a remote provider cannot be recalled.
- Forgetting, deleting, or editing sources invalidates affected jobs and caches. Late responses cannot resurrect deleted content.
- An invalid public patch causes the combined transaction to fail, even if the internal patch was valid. This keeps the two results on a shared revision; measure whether retry coupling becomes costly before splitting commits.
- On lock or shutdown, stop model and microphone work. Resume only from encrypted durable work after unlock. No unrequested overnight processing.

## Speech input at launch, pending clarification

Interpret the input requirement as typing or dictation, with text-only output. Propose [whisper.cpp](https://github.com/ggml-org/whisper.cpp) for local speech recognition because it supports macOS and Windows. Model choice and accuracy remain to be tested.

Microphone permission is requested at first use. Capture begins only on user action, shows a persistent recording state, and stops on cancel, lock, device loss, or timeout. Local transcription produces an editable draft. Do not auto-send on a pause in speech. The user confirms the words before they become clinical conversation evidence.

Keep audio transient by default and discard it after transcription or cancellation. Bound the recording length and memory use; never silently spill plaintext audio into temporary files. Test names, negation, numbers, medication names, accents, background noise, and silence. Do not infer emotion or a diagnosis from vocal tone.

Coordinate speech recognition and LLM inference through a shared resource budget. Dictation may preempt pending note work; on constrained hardware, sequence transcription and reply generation rather than keeping both large models resident. Typing remains available when microphone permission, model loading, or recognition fails.

## Text-to-speech later

Add a separate output adapter that consumes only text already approved for display. [ElevenLabs' streaming speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) is one candidate. It is an optional remote processor even when the conversation model runs locally.

Obtain separate consent for sending response text to the speech provider. It does not need the transcript, raw graph, microphone audio, or notebook. Voice ID, credentials, output format, and retention behavior belong to speech-provider configuration. Playback has its own stop control and bounded queue; starting a new turn clears stale audio.

Do not promise zero retention by default. ElevenLabs documents [zero-retention mode](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode) with service and account conditions that must be checked when the integration is built. A future local speech-synthesis adapter can preserve offline operation. No TTS dependency or service is added during this planning phase.

## Evaluation and optimization

Measure response latency separately from completion time for both note patches. Record warm/cold model loads, context tokens, generation tokens, note-job retries, queue age, and transcription latency without content logs.

Begin with the two-call design, bounded context, incremental patches, and one resident conversation model. Test these against three separate calls and a single mixed response-plus-notes stream. Three calls repeat source processing; one mixed stream couples note parsing and cancellation to user delivery and increases accidental disclosure risk. Neither alternative is automatically faster on every runtime, so keep benchmark results with the decision.

Required regressions include interrupted streams, reload after chunk persistence, notebook edits during generation, empty patches, delayed note jobs, coalesced turn coverage, deletion races, consent revocation, and voice draft correction. Clinical evaluations must examine visible notes as well as conversation responses.
