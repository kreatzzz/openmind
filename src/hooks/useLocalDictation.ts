import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLocalSpeechAvailability,
  installLocalSpeechModel,
  startLocalSpeechRecognition,
  type LocalSpeechAvailability,
  type LocalSpeechSession,
} from "../lib/localSpeechRecognition";

export type LocalDictationPhase =
  | "checking"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "ready"
  | "listening"
  | "finishing"
  | "error";

export interface LocalDictation {
  phase: LocalDictationPhase;
  message: string;
  install: () => Promise<void>;
  start: () => Promise<void>;
  finish: () => void;
  cancel: () => void;
}

function phaseForAvailability(
  availability: LocalSpeechAvailability,
): LocalDictationPhase {
  if (availability.status === "ready") return "ready";
  if (availability.status === "downloadable") return "downloadable";
  if (availability.status === "downloading") return "downloading";
  return "unavailable";
}

function appendAtSelection(
  original: string,
  start: number,
  end: number,
  spoken: string,
) {
  const before = original.slice(0, start);
  const after = original.slice(end);
  const leadingSpace = before && !/\s$/.test(before) && spoken ? " " : "";
  const trailingSpace = after && !/^\s/.test(after) && spoken ? " " : "";
  return `${before}${leadingSpace}${spoken}${trailingSpace}${after}`;
}

/**
 * A fail-closed dictation controller. Recognition is started only after the
 * runtime proves it can process speech locally. The result remains an editable
 * draft and this hook never submits it.
 */
export function useLocalDictation({
  language,
  value,
  onValueChange,
  selection,
  sessionKey,
  disabled,
}: {
  language: string;
  value: string;
  onValueChange: (value: string) => void;
  selection: () => { start: number; end: number };
  sessionKey: string | null;
  disabled: boolean;
}): LocalDictation {
  const [phase, setPhase] = useState<LocalDictationPhase>("checking");
  const [message, setMessage] = useState("Checking local dictation support");
  const availabilityRef = useRef<LocalSpeechAvailability | null>(null);
  const sessionRef = useRef<LocalSpeechSession | null>(null);
  const sessionKeyRef = useRef(sessionKey);
  const requestRef = useRef(0);
  const valueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  const originalRef = useRef(value);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const finalTextRef = useRef("");
  const interimTextRef = useRef("");

  valueRef.current = value;
  onValueChangeRef.current = onValueChange;

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setPhase("checking");
    setMessage("Checking local dictation support");
    const availability = await getLocalSpeechAvailability(language);
    if (request !== requestRef.current) return;
    availabilityRef.current = availability;
    setPhase(phaseForAvailability(availability));
    if (availability.status === "ready") {
      setMessage("Dictation stays on this device");
    } else if (availability.status === "downloadable") {
      setMessage("Install the local speech model to use dictation");
    } else if (availability.status === "downloading") {
      setMessage("The local speech model is downloading");
    } else {
      setMessage(availability.reason);
    }
  }, [language]);

  useEffect(() => {
    if (disabled) {
      requestRef.current += 1;
      setPhase("unavailable");
      setMessage("Finish the current action before starting dictation");
      return;
    }
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [disabled, refresh]);

  const cancelSession = useCallback((restoreDraft: boolean) => {
    requestRef.current += 1;
    sessionRef.current?.cancel();
    sessionRef.current = null;
    if (restoreDraft) onValueChangeRef.current(originalRef.current);
    const availability = availabilityRef.current;
    setPhase(availability ? phaseForAvailability(availability) : "checking");
    setMessage(
      availability?.status === "ready"
        ? "Dictation stays on this device"
        : availability?.status === "unavailable"
          ? availability.reason
          : "Dictation stopped",
    );
  }, []);

  useEffect(() => {
    if (!disabled) return;
    cancelSession(false);
    setPhase("unavailable");
    setMessage("Finish the current action before starting dictation");
  }, [cancelSession, disabled]);

  useEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    sessionKeyRef.current = sessionKey;
    cancelSession(false);
    // A conversation change must stop capture, even when the component stays
    // mounted. The destination draft is managed by the parent.
  }, [cancelSession, sessionKey]);

  useEffect(
    () => () => {
      sessionRef.current?.cancel();
    },
    [],
  );

  const install = useCallback(async () => {
    if (disabled || availabilityRef.current?.status !== "downloadable") return;
    const request = ++requestRef.current;
    setPhase("downloading");
    setMessage("Installing the local speech model");
    const installed = await installLocalSpeechModel(language);
    if (request !== requestRef.current) return;
    if (!installed) {
      setPhase("error");
      setMessage("The local speech model could not be installed");
      return;
    }
    await refresh();
  }, [disabled, language, refresh]);

  const start = useCallback(async () => {
    if (
      disabled ||
      sessionRef.current ||
      availabilityRef.current?.status !== "ready"
    )
      return;

    const request = ++requestRef.current;
    originalRef.current = valueRef.current;
    selectionRef.current = selection();
    finalTextRef.current = "";
    interimTextRef.current = "";
    setMessage("Starting local dictation");

    try {
      let ended = false;
      let failed = false;
      const speech = await startLocalSpeechRecognition({
        language,
        onEvent: (event) => {
          if (request !== requestRef.current) return;
          if (event.type === "listening") {
            setPhase("listening");
            setMessage("Listening on this device");
            return;
          }
          if (event.type === "transcript") {
            if (event.final) {
              finalTextRef.current = [finalTextRef.current, event.text]
                .filter(Boolean)
                .join(" ");
              interimTextRef.current = "";
            } else {
              interimTextRef.current = event.text;
            }
            const spoken = [finalTextRef.current, interimTextRef.current]
              .filter(Boolean)
              .join(" ");
            onValueChangeRef.current(
              appendAtSelection(
                originalRef.current,
                selectionRef.current.start,
                selectionRef.current.end,
                spoken,
              ),
            );
            return;
          }
          if (event.type === "error") {
            ended = true;
            failed = true;
            sessionRef.current = null;
            setPhase("error");
            setMessage(event.message);
            return;
          }
          if (event.type === "ended") {
            ended = true;
            sessionRef.current = null;
            if (failed) return;
            setPhase("ready");
            setMessage("Dictation added to your draft");
          }
        },
      });
      if (request !== requestRef.current) {
        speech.cancel();
        return;
      }
      if (ended) return;
      sessionRef.current = speech;
    } catch (reason) {
      setPhase("error");
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Local dictation could not start",
      );
    }
  }, [disabled, language, selection]);

  const finish = useCallback(() => {
    if (!sessionRef.current) return;
    setPhase("finishing");
    setMessage("Finishing dictation");
    sessionRef.current.stop();
  }, []);

  const cancel = useCallback(() => cancelSession(true), [cancelSession]);

  return {
    phase,
    message,
    install,
    start,
    finish,
    cancel,
  };
}
