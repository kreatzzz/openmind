import { useState } from "react";
import { ArrowUpRight, BookOpen, Pencil, Trash2 } from "lucide-react";
import type { UserNote } from "../lib/desktop";

const labels = {
  takeaway: "Takeaway",
  question: "To return to",
  next_step: "Suggested next step",
};

export function Notebook({
  notes,
  sample,
  disabled,
  onEdit,
  onDelete,
  onSource,
}: {
  notes: UserNote[];
  sample: boolean;
  disabled: boolean;
  onEdit: (note: UserNote, content: string) => Promise<void>;
  onDelete: (note: UserNote) => Promise<void>;
  onSource: (note: UserNote) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(note: UserNote, remove = false) {
    setPending(true);
    setError("");
    try {
      if (remove) await onDelete(note);
      else await onEdit(note, content.trim());
      setEditing(null);
      setDeleting(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="notebook-scroll">
      <div className="notebook-column">
        <div className="notebook-heading">
          <div>
            <h1>Your notes</h1>
            <p>
              Takeaways and questions from your conversations. Yours to edit.
            </p>
          </div>
          <span className="preview-badge">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        </div>
        {sample && (
          <p className="notebook-disclosure">
            These fictional notes are editable. Changes last until you close the
            demo.
          </p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!notes.length && (
          <div className="notes-empty">
            <BookOpen size={28} />
            <h2>No notes yet</h2>
            <p>
              After a completed reply, Openmind can save useful takeaways here
              with links to the conversation.
            </p>
          </div>
        )}
        {notes.map((note) => (
          <article className="note-card" key={note.id}>
            <div className="note-meta">
              <span>{labels[note.kind]}</span>
              {note.edited && (
                <span className="preview-badge">Edited by you</span>
              )}
              <time dateTime={note.createdAt}>
                {new Date(note.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </div>
            {editing === note.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(note);
                }}
              >
                <label className="sr-only" htmlFor={`note-${note.id}`}>
                  Edit note
                </label>
                <textarea
                  autoFocus
                  id={`note-${note.id}`}
                  className="note-editor"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  disabled={pending}
                  maxLength={600}
                />
                <div className="note-actions">
                  <button
                    className="primary-button"
                    disabled={pending || !content.trim() || disabled}
                  >
                    Save note
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p className="note-content">{note.content}</p>
            )}
            <blockquote>{note.evidenceQuote}</blockquote>
            <div className="note-actions">
              <button
                className="text-button"
                disabled={pending || disabled}
                onClick={() => {
                  setError("");
                  void onSource(note).catch((reason: unknown) =>
                    setError(String(reason)),
                  );
                }}
              >
                View conversation <ArrowUpRight size={14} />
              </button>
              <div className="ml-auto" />
              {editing !== note.id && (
                <button
                  className="icon-button"
                  aria-label="Edit note"
                  disabled={pending || disabled}
                  onClick={() => {
                    setEditing(note.id);
                    setContent(note.content);
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Delete note"
                disabled={pending || disabled}
                onClick={() => setDeleting(note.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {deleting === note.id && (
              <div className="delete-confirm">
                <p>
                  Delete this notebook entry? The conversation and its internal
                  memory will stay.
                </p>
                <div className="note-actions">
                  <button
                    className="secondary-button danger-button"
                    disabled={pending || disabled}
                    onClick={() => void save(note, true)}
                  >
                    Delete note
                  </button>
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() => setDeleting(null)}
                  >
                    Keep note
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
