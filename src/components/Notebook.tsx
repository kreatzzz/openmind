import { useState } from "react";
import { ArrowUpRight, BookOpen, Pencil, Trash2 } from "lucide-react";
import type { UserNote } from "../lib/desktop";

const labels = {
  takeaway: "Takeaway",
  question: "To return to",
  next_step: "Suggested next step",
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const getErrorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function Notebook({
  notes,
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
      setError(getErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="notebook-scroll" aria-labelledby="notebook-heading">
      <div className="notebook-column">
        <header className="notebook-heading">
          <div>
            <h1 id="notebook-heading">Your notes</h1>
            <p>
              Takeaways and questions saved from your conversations. You can
              revise or remove them at any time.
            </p>
          </div>
          <span
            className="notebook-count"
            aria-label={`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
          >
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </span>
        </header>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {!notes.length && (
          <div className="notes-empty">
            <BookOpen size={28} aria-hidden="true" />
            <h2>No notes yet</h2>
            <p>
              After a completed reply, Openmind can save useful takeaways here
              with links to the conversation.
            </p>
          </div>
        )}
        <div className="notes-list">
          {notes.map((note) => (
            <article className="note-card" key={note.id}>
              <header className="note-meta">
                <span className="note-kind">{labels[note.kind]}</span>
                {note.edited && <span>Edited by you</span>}
                <time
                  className="note-date"
                  dateTime={note.createdAt}
                  title={formatDate(note.createdAt)}
                >
                  {formatDate(note.createdAt)}
                </time>
              </header>
              {editing === note.id ? (
                <form
                  className="note-editor-form"
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
                    disabled={pending || disabled}
                    maxLength={600}
                  />
                  <div className="note-actions">
                    <button
                      className="primary-button"
                      disabled={pending || !content.trim() || disabled}
                    >
                      {pending ? "Saving…" : "Save note"}
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

              <div className="note-evidence">
                <p className="note-evidence-label">Source evidence</p>
                <blockquote>{note.evidenceQuote}</blockquote>
              </div>

              <footer className="note-actions note-card-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={pending || disabled}
                  onClick={() => {
                    setError("");
                    void onSource(note).catch((reason: unknown) =>
                      setError(getErrorMessage(reason)),
                    );
                  }}
                >
                  View conversation
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
                <div className="ml-auto" />
                {editing !== note.id && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Edit note"
                    disabled={pending || disabled}
                    onClick={() => {
                      setError("");
                      setDeleting(null);
                      setEditing(note.id);
                      setContent(note.content);
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete note"
                  disabled={pending || disabled}
                  onClick={() => {
                    setError("");
                    setEditing(null);
                    setDeleting(note.id);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </footer>
              {deleting === note.id && (
                <div className="delete-confirm">
                  <p>
                    Delete this notebook entry? The conversation and its
                    remembered context will stay.
                  </p>
                  <div className="note-actions">
                    <button
                      type="button"
                      className="secondary-button danger-button"
                      disabled={pending || disabled}
                      onClick={() => void save(note, true)}
                    >
                      {pending ? "Deleting…" : "Delete note"}
                    </button>
                    <button
                      type="button"
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
      </div>
    </section>
  );
}
