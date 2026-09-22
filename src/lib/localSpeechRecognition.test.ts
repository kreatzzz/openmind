import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalSpeechAvailability,
  installLocalSpeechModel,
  startLocalSpeechRecognition,
  type LocalSpeechEvent,
} from "./localSpeechRecognition";

interface FakeRecognitionConstructor {
  new (): FakeRecognition;
  available: ReturnType<typeof vi.fn>;
  install?: ReturnType<typeof vi.fn>;
  instance?: FakeRecognition;
}

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  processLocally = false;
  onstart: ((event: Event) => void) | null = null;
  onresult: ((event: never) => void) | null = null;
  onerror: ((event: never) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

function setRecognizer(
  availability: "available" | "downloadable" | "unavailable" = "available",
) {
  const Recognition = class extends FakeRecognition {
    static available = vi.fn().mockResolvedValue(availability);
    static install = vi.fn().mockResolvedValue(true);
    static instance?: FakeRecognition;

    constructor() {
      super();
      Recognition.instance = this;
    }
  } as FakeRecognitionConstructor;

  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: Recognition,
  });
  return Recognition;
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "SpeechRecognition");
  Reflect.deleteProperty(globalThis, "webkitSpeechRecognition");
});

describe("local speech recognition", () => {
  it("rejects the prefixed cloud-capable API", async () => {
    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });

    await expect(getLocalSpeechAvailability("en-US")).resolves.toEqual({
      status: "unavailable",
      reason:
        "On-device speech recognition is not available in this desktop runtime.",
    });
  });

  it("reports model downloads without starting them", async () => {
    const Recognition = setRecognizer("downloadable");

    await expect(getLocalSpeechAvailability("en-US")).resolves.toEqual({
      status: "downloadable",
    });
    expect(Recognition.install).not.toHaveBeenCalled();
  });

  it("installs a model only through the explicit install operation", async () => {
    const Recognition = setRecognizer("downloadable");

    await expect(installLocalSpeechModel("en-US")).resolves.toBe(true);
    expect(Recognition.install).toHaveBeenCalledWith({
      langs: ["en-US"],
      processLocally: true,
    });
  });

  it("requires local processing before microphone capture starts", async () => {
    const Recognition = setRecognizer();
    const events: LocalSpeechEvent[] = [];
    const session = await startLocalSpeechRecognition({
      language: "en-US",
      onEvent: (event) => events.push(event),
    });
    const instance = Recognition.instance;

    expect(instance).toBeDefined();
    expect(instance?.processLocally).toBe(true);
    expect(instance?.lang).toBe("en-US");
    expect(instance?.continuous).toBe(true);
    expect(instance?.interimResults).toBe(true);
    expect(instance?.start).toHaveBeenCalledOnce();

    instance?.onstart?.(new Event("start"));
    expect(events).toEqual([{ type: "listening" }]);

    session.stop();
    session.cancel();
    expect(instance?.stop).toHaveBeenCalledOnce();
    expect(instance?.abort).toHaveBeenCalledOnce();
  });

  it("emits editable transcript fragments and hides expected abort errors", async () => {
    const Recognition = setRecognizer();
    const events: LocalSpeechEvent[] = [];
    const session = await startLocalSpeechRecognition({
      language: "en-US",
      onEvent: (event) => events.push(event),
    });
    const instance = Recognition.instance;

    instance?.onresult?.({
      resultIndex: 0,
      results: {
        0: {
          0: { transcript: "  I feel unsure  " },
          isFinal: false,
          length: 1,
        },
        1: { 0: { transcript: "about tomorrow" }, isFinal: true, length: 1 },
        length: 2,
      },
    } as never);

    expect(events).toEqual([
      { type: "transcript", text: "I feel unsure", final: false },
      { type: "transcript", text: "about tomorrow", final: true },
    ]);

    session.cancel();
    instance?.onerror?.({ error: "aborted" } as never);
    expect(events).toHaveLength(2);
  });

  it("does not start recognition while a model is missing", async () => {
    const Recognition = setRecognizer("downloadable");

    await expect(
      startLocalSpeechRecognition({ language: "en-US", onEvent: vi.fn() }),
    ).rejects.toThrow(
      "Install the on-device language model before starting dictation.",
    );
    expect(Recognition.instance).toBeUndefined();
  });

  it("stops continuous capture after the bounded recording window", async () => {
    vi.useFakeTimers();
    const Recognition = setRecognizer();
    const events: LocalSpeechEvent[] = [];
    await startLocalSpeechRecognition({
      language: "en-US",
      onEvent: (event) => events.push(event),
    });
    const instance = Recognition.instance;

    instance?.onstart?.(new Event("start"));
    vi.advanceTimersByTime(120_000);

    expect(instance?.stop).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({
      type: "error",
      message:
        "Dictation stopped after two minutes. Review your draft before continuing.",
    });
  });
});
