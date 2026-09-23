import { useId, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  LoaderCircle,
  Mic,
  Square,
  X,
} from "lucide-react";
import type { LocalDictationPhase } from "../hooks/useLocalDictation";

export function DictationControl({
  phase,
  message,
  disabled,
  onInstall,
  onStart,
  onFinish,
  onCancel,
  onRetry,
}: {
  phase: LocalDictationPhase;
  message: string;
  disabled: boolean;
  onInstall: () => void;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const detailsTrigger = useRef<HTMLButtonElement>(null);
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

  if (phase === "checking") {
    return (
      <span className="dictation-info-control" role="status">
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
        Checking dictation
      </span>
    );
  }

  if (phase === "unavailable" || phase === "starting" || phase === "error") {
    const failed = phase === "error";
    return (
      <div className="dictation-info-control">
        <button
          ref={detailsTrigger}
          className="composer-icon-button"
          type="button"
          aria-label={
            failed
              ? "Dictation error details"
              : phase === "starting"
                ? "Starting local dictation"
                : "Why is dictation unavailable?"
          }
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          title={message}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {failed ? (
            <CircleAlert size={17} />
          ) : phase === "starting" ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Mic size={17} />
          )}
        </button>
        {failed && (
          <span className="dictation-error-label" role="alert">
            Dictation stopped
          </span>
        )}
        {detailsOpen && (
          <div className="dictation-detail" id={detailsId} role="status">
            <strong>
              {failed
                ? "Dictation stopped"
                : phase === "starting"
                  ? "Starting dictation"
                  : "Local dictation"}
            </strong>
            <p>{message}</p>
            {failed && (
              <button
                type="button"
                onClick={() => {
                  detailsTrigger.current?.focus();
                  setDetailsOpen(false);
                  onRetry();
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
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
