export type LocalSpeechAvailability =
  | { status: "ready" }
  | { status: "downloadable" }
  | { status: "downloading" }
  | { status: "unavailable"; reason: string };

export type LocalSpeechEvent =
  | { type: "listening" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "ended" }
  | { type: "error"; message: string };

export interface LocalSpeechSession {
  /** Requests a final recognition result from the audio captured so far. */
  stop(): void;
  /** Immediately ends recognition and discards outstanding audio. */
  cancel(): void;
}

interface RecognitionAlternativeLike {
  transcript: string;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternativeLike;
}

interface RecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: RecognitionResultLike;
}

interface RecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: RecognitionResultListLike;
}

interface RecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

interface LocalRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally: boolean;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionAvailability =
  "available" | "downloadable" | "downloading" | "unavailable";

interface LocalRecognitionConstructor {
  new (): LocalRecognitionLike;
  available(options: {
    langs: string[];
    processLocally: true;
  }): Promise<RecognitionAvailability>;
  install?(options: {
    langs: string[];
    processLocally: true;
  }): Promise<boolean>;
}

const NO_LOCAL_RECOGNIZER =
  "On-device speech recognition is not available in this desktop runtime.";
const MAX_DICTATION_MS = 120_000;

function localRecognitionConstructor(): LocalRecognitionConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & {
      SpeechRecognition?: LocalRecognitionConstructor;
    }
  ).SpeechRecognition;

  // Do not use webkitSpeechRecognition. That older API cannot require local
  // processing and may send microphone audio to a platform service.
  if (
    typeof candidate !== "function" ||
    typeof candidate.available !== "function"
  ) {
    return null;
  }

  return candidate;
}

export async function getLocalSpeechAvailability(
  language: string,
): Promise<LocalSpeechAvailability> {
  const Recognition = localRecognitionConstructor();
  if (!Recognition) {
    return { status: "unavailable", reason: NO_LOCAL_RECOGNIZER };
  }

  try {
    const status = await Recognition.available({
      langs: [language],
      processLocally: true,
    });

    if (status === "available") return { status: "ready" };
    if (status === "downloadable") return { status: "downloadable" };
    if (status === "downloading") return { status: "downloading" };
    return {
      status: "unavailable",
      reason: `On-device speech recognition is unavailable for ${language}.`,
    };
  } catch {
    return { status: "unavailable", reason: NO_LOCAL_RECOGNIZER };
  }
}

/**
 * Downloads only the runtime's language model. Call this from an explicit user
 * action; it never starts the microphone or uploads recorded audio.
 */
export async function installLocalSpeechModel(
  language: string,
): Promise<boolean> {
  const Recognition = localRecognitionConstructor();
  if (!Recognition?.install) return false;

  try {
    return await Recognition.install({
      langs: [language],
      processLocally: true,
    });
  } catch {
    return false;
  }
}

function speechErrorMessage(event: RecognitionErrorEventLike): string {
  switch (event.error) {
    case "aborted":
      return "Dictation was cancelled.";
    case "audio-capture":
      return "Openmind could not access the microphone.";
    case "language-not-supported":
      return "The on-device language model is not available.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was not allowed.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return event.message?.trim() || "Dictation stopped unexpectedly.";
  }
}

export async function startLocalSpeechRecognition({
  language,
  onEvent,
}: {
  language: string;
  onEvent: (event: LocalSpeechEvent) => void;
}): Promise<LocalSpeechSession> {
  const availability = await getLocalSpeechAvailability(language);
  if (availability.status !== "ready") {
    const detail =
      availability.status === "unavailable"
        ? availability.reason
        : "Install the on-device language model before starting dictation.";
    throw new Error(detail);
  }

  const Recognition = localRecognitionConstructor();
  if (!Recognition) throw new Error(NO_LOCAL_RECOGNIZER);

  const recognition = new Recognition();
  if (!("processLocally" in recognition)) {
    throw new Error(NO_LOCAL_RECOGNIZER);
  }

  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.processLocally = true;
  let cancelled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const clearTimeoutIfNeeded = () => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
  recognition.onstart = () => {
    onEvent({ type: "listening" });
    timeout = setTimeout(() => {
      timeout = undefined;
      if (cancelled) return;
      onEvent({
        type: "error",
        message: "Dictation stopped after two minutes. Review your draft before continuing.",
      });
      recognition.stop();
    }, MAX_DICTATION_MS);
  };
  recognition.onresult = (event) => {
    for (
      let index = event.resultIndex;
      index < event.results.length;
      index += 1
    ) {
      const result = event.results[index];
      if (!result) continue;
      const text = result?.[0]?.transcript.trim();
      if (text) {
        onEvent({ type: "transcript", text, final: result.isFinal });
      }
    }
  };
  recognition.onerror = (event) => {
    clearTimeoutIfNeeded();
    if (cancelled && event.error === "aborted") return;
    onEvent({ type: "error", message: speechErrorMessage(event) });
  };
  recognition.onend = () => {
    clearTimeoutIfNeeded();
    onEvent({ type: "ended" });
  };
  recognition.start();

  return {
    stop: () => {
      clearTimeoutIfNeeded();
      recognition.stop();
    },
    cancel: () => {
      cancelled = true;
      clearTimeoutIfNeeded();
      recognition.abort();
    },
  };
}
