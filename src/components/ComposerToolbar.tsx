import { ArrowUp, Square } from "lucide-react";
import type { ReactNode } from "react";
import { ModelActivity } from "./ModelActivity";

export function ComposerToolbar({
  canSend,
  connectionReady,
  enterToSend,
  hasReplyContent,
  leadingControls,
  noteStatus,
  onStop,
  sending,
  stopping,
}: {
  canSend: boolean;
  connectionReady: boolean;
  enterToSend: boolean;
  hasReplyContent: boolean;
  leadingControls?: ReactNode;
  noteStatus: string;
  onStop: () => void;
  sending: boolean;
  stopping: boolean;
}) {
  const phase = stopping
    ? "stopping"
    : hasReplyContent
      ? "responding"
      : "preparing";

  return (
    <div className="composer-toolbar">
      <div className="composer-toolbar-leading">
        {leadingControls}
        {sending ? (
          <ModelActivity phase={phase} label={noteStatus || undefined} />
        ) : (
          <span className="composer-hint">
            {enterToSend
              ? "Shift + Enter for a new line"
              : "Ctrl / ⌘ + Enter to send"}
          </span>
        )}
      </div>
      {sending ? (
        <button
          className="send-button"
          type="button"
          aria-label={stopping ? "Stopping reply" : "Stop reply"}
          onClick={onStop}
          disabled={stopping}
        >
          <Square size={15} fill="currentColor" />
        </button>
      ) : (
        <button
          className="send-button"
          type="submit"
          aria-label={
            connectionReady ? "Send message" : "Set up model connection"
          }
          disabled={!canSend}
        >
          <ArrowUp size={19} />
        </button>
      )}
    </div>
  );
}
