import { useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { Dialog } from "./Dialog";
import type { Session } from "../lib/desktop";

export function ConversationControls({
  session,
  disabled,
  sample,
  onClose,
  onSave,
}: {
  session: Session;
  disabled: boolean;
  sample: boolean;
  onClose: () => void;
  onSave: (
    session: Session,
    title: string,
    memoryEnabled: boolean,
    notesEnabled: boolean,
  ) => Promise<Session | null>;
}) {
  const [title, setTitle] = useState(session.title);
  const [memoryEnabled, setMemoryEnabled] = useState(
    session.memoryEnabled !== false,
  );
  const [notesEnabled, setNotesEnabled] = useState(
    session.notesEnabled !== false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("Add a title before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await onSave(
        session,
        nextTitle,
        memoryEnabled,
        notesEnabled,
      );
      if (updated) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Conversation controls" onClose={onClose}>
      <form className="conversation-controls" onSubmit={save}>
        <p className="conversation-controls-intro">
          Choose which parts of this conversation can update Openmind.
        </p>

        {error && (
          <div className="conversation-controls-error" role="alert">
            <CircleAlert size={16} />
            <span>{error}</span>
          </div>
        )}

        <label htmlFor="conversation-title">Conversation title</label>
        <input
          id="conversation-title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          disabled={disabled || saving}
          autoFocus
        />
        <p className="field-hint">
          Shown in your conversation history and source links.
        </p>

        <fieldset className="conversation-preferences">
          <legend>Saved updates</legend>
          <label className="conversation-toggle" htmlFor="memory-enabled">
            <span>
              <strong id="memory-enabled-label">Remembered context</strong>
              <small id="memory-enabled-description">
                Use saved context for replies and save new context from this
                conversation. Existing context stays available elsewhere.
              </small>
            </span>
            <input
              id="memory-enabled"
              type="checkbox"
              aria-labelledby="memory-enabled-label"
              aria-describedby="memory-enabled-description"
              checked={memoryEnabled}
              onChange={(event) => setMemoryEnabled(event.target.checked)}
              disabled={disabled || saving}
            />
          </label>
          <label className="conversation-toggle" htmlFor="notes-enabled">
            <span>
              <strong id="notes-enabled-label">Your notes</strong>
              <small id="notes-enabled-description">
                Add or update notebook entries after replies. Existing notes
                stay when this is off.
              </small>
            </span>
            <input
              id="notes-enabled"
              type="checkbox"
              aria-labelledby="notes-enabled-label"
              aria-describedby="notes-enabled-description"
              checked={notesEnabled}
              onChange={(event) => setNotesEnabled(event.target.checked)}
              disabled={disabled || saving}
            />
          </label>
        </fieldset>

        <p className="conversation-controls-note">
          {sample
            ? "This browser demo is temporary; your controls reset when you close it."
            : "In the desktop app, your conversation stays saved and can be used in replies here."}{" "}
          Turning a setting off also stops pending updates of that kind. Turning
          it on applies only to new messages.
        </p>

        <div className="conversation-controls-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={disabled || saving || !title.trim()}
          >
            {saving
              ? "Saving…"
              : sample
                ? "Save for this demo"
                : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
