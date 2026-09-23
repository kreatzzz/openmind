import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalSpeechAvailability,
  installLocalSpeechModel,
  startLocalSpeechRecognition,
  type LocalSpeechEvent,
} from "../lib/localSpeechRecognition";
import { useLocalDictation } from "./useLocalDictation";

vi.mock("../lib/localSpeechRecognition", () => ({
  getLocalSpeechAvailability: vi.fn(),
  installLocalSpeechModel: vi.fn(),
  startLocalSpeechRecognition: vi.fn(),
}));

describe("useLocalDictation", () => {
  const stop = vi.fn();
  const cancel = vi.fn();
  let emit: ((event: LocalSpeechEvent) => void) | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLocalSpeechAvailability).mockResolvedValue({
      status: "ready",
    });
    vi.mocked(installLocalSpeechModel).mockResolvedValue(true);
    vi.mocked(startLocalSpeechRecognition).mockImplementation(
      async ({ onEvent }) => {
        emit = onEvent;
        return { stop, cancel };
      },
    );
  });

  it("inserts local speech at the current selection without submitting it", async () => {
    const onValueChange = vi.fn();
    const { result } = renderHook(() =>
      useLocalDictation({
        language: "en-US",
        value: "Today felt difficult.",
        onValueChange,
        selection: () => ({ start: 5, end: 5 }),
        sessionKey: "synthetic-session",
        disabled: false,
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.start());
    act(() => emit?.({ type: "listening" }));
    act(() => emit?.({ type: "transcript", text: "has been", final: false }));
    expect(onValueChange).toHaveBeenLastCalledWith(
      "Today has been felt difficult.",
    );

    act(() => emit?.({ type: "transcript", text: "has been", final: true }));
    act(() =>
      emit?.({ type: "transcript", text: "really hard", final: false }),
    );
    expect(onValueChange).toHaveBeenLastCalledWith(
      "Today has been really hard felt difficult.",
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it("restores the typed draft when dictation is cancelled", async () => {
    const onValueChange = vi.fn();
    const { result } = renderHook(() =>
      useLocalDictation({
        language: "en-US",
        value: "Keep this",
        onValueChange,
        selection: () => ({ start: 9, end: 9 }),
        sessionKey: "synthetic-session",
        disabled: false,
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.start());
    act(() => emit?.({ type: "transcript", text: "and this", final: false }));
    act(() => result.current.cancel());

    expect(cancel).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenLastCalledWith("Keep this");
  });

  it("cancels capture without rewriting the destination draft on session change", async () => {
    const onValueChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessionKey }) =>
        useLocalDictation({
          language: "en-US",
          value: "First draft",
          onValueChange,
          selection: () => ({ start: 11, end: 11 }),
          sessionKey,
          disabled: false,
        }),
      { initialProps: { sessionKey: "first" as string | null } },
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.start());
    rerender({ sessionKey: "second" });

    expect(cancel).toHaveBeenCalledOnce();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps an error visible when recognition subsequently ends", async () => {
    const { result } = renderHook(() =>
      useLocalDictation({
        language: "en-US",
        value: "Draft",
        onValueChange: vi.fn(),
        selection: () => ({ start: 5, end: 5 }),
        sessionKey: "synthetic-session",
        disabled: false,
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.start());
    act(() => {
      emit?.({ type: "error", message: "Microphone disconnected" });
      emit?.({ type: "ended" });
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.message).toBe("Microphone disconnected");
  });

  it("starts only one capture when retry is activated twice before startup finishes", async () => {
    let completeStart:
      | ((session: { stop: typeof stop; cancel: typeof cancel }) => void)
      | undefined;
    vi.mocked(startLocalSpeechRecognition).mockImplementation(
      () =>
        new Promise((resolve) => {
          completeStart = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useLocalDictation({
        language: "en-US",
        value: "Draft",
        onValueChange: vi.fn(),
        selection: () => ({ start: 5, end: 5 }),
        sessionKey: "synthetic-session",
        disabled: false,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.retry();
      second = result.current.retry();
    });
    expect(result.current.phase).toBe("starting");
    expect(startLocalSpeechRecognition).toHaveBeenCalledOnce();
    await act(async () => {
      completeStart?.({ stop, cancel });
      await Promise.all([first, second]);
    });
  });

  it("cancels capture when its conversation surface is hidden", async () => {
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useLocalDictation({
          language: "en-US",
          value: "Draft",
          onValueChange: vi.fn(),
          selection: () => ({ start: 5, end: 5 }),
          sessionKey: "synthetic-session",
          disabled,
        }),
      { initialProps: { disabled: false } },
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.start());
    rerender({ disabled: true });

    expect(cancel).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe("unavailable");
  });
});
