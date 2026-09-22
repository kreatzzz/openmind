import { Download, LoaderCircle, Mic, Square, X } from "lucide-react";
import type { LocalDictationPhase } from "../hooks/useLocalDictation";

export function DictationControl({
  phase,
  message,
  disabled,
  onInstall,
  onStart,
  onFinish,
  onCancel,
}: {
  phase: LocalDictationPhase;
  message: string;
  disabled: boolean;
  onInstall: () => void;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  if (phase === "listening" || phase === "finishing") {
    return (
      <div className="dictation-active" role="status" aria-live="polite">
        <span className="dictation-label">
          <span className="recording-dot" aria-hidden="true" />
          {phase === "listening" ? "Listening locally" : "Finishing dictation"}
        </span>
        <button
          className="composer-icon-button"
          type="button"
          aria-label="Finish dictation"
          title="Finish dictation"
          onClick={onFinish}
          disabled={phase === "finishing"}
        >
          {phase === "finishing" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Square size={13} fill="currentColor" />
          )}
        </button>
        <button
          className="composer-icon-button"
          type="button"
          aria-label="Cancel dictation"
          title="Cancel dictation and remove it from the draft"
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  if (phase === "downloadable" || phase === "downloading") {
    return (
      <button
        className="dictation-setup"
        type="button"
        onClick={onInstall}
        disabled={disabled || phase === "downloading"}
        title={message}
      >
        {phase === "downloading" ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Download size={15} />
        )}
        <span>
          {phase === "downloading"
            ? "Installing dictation"
            : "Set up dictation"}
        </span>
      </button>
    );
  }

  const unavailable = phase === "unavailable" || phase === "checking";
  if (unavailable) {
    return (
      <div className="dictation-unavailable">
        <button
          className="composer-icon-button"
          type="button"
          aria-disabled="true"
          aria-describedby="dictation-unavailable-reason"
          title={message}
        >
          <Mic size={17} />
        </button>
        <span id="dictation-unavailable-reason">
          {phase === "checking"
            ? "Checking dictation"
            : "Dictation unavailable"}
        </span>
      </div>
    );
  }

  return (
    <button
      className="composer-icon-button"
      type="button"
      aria-label="Start dictation"
      title={message}
      onClick={onStart}
      disabled={disabled}
    >
      <Mic size={17} />
    </button>
  );
}
