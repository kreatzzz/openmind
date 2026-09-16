import { useState } from "react";
import {
  ArrowUpRight,
  Brain,
  CircleAlert,
  MessageSquareQuote,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { MemoryRecord, Session, UserNote } from "../lib/desktop";

const groupOrder = [
  "person",
  "event",
  "goal",
  "preference",
  "concern",
] as const;

const groupLabels: Record<(typeof groupOrder)[number], string> = {
  person: "People",
  event: "Events",
  goal: "Goals",
  preference: "Preferences",
  concern: "Concerns",
};

const evidenceLabels: Record<string, string> = {
  user_reported: "You reported this",
  user_confirmed: "You confirmed this",
  inferred: "Openmind inferred this",
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const getErrorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function MemoryWorkspace({
  memories,
  notes,
  sessions,
  sample,
  disabled,
  loading = false,
  error = "",
  onRetry,
  onEdit,
  onDelete,
  onSource,
}: {
  memories: MemoryRecord[];
  notes: UserNote[];
  sessions: Session[];
  sample: boolean;
  disabled: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => Promise<void>;
  onEdit: (memory: MemoryRecord, content: string) => Promise<void>;
  onDelete: (memory: MemoryRecord) => Promise<void>;
  onSource: (memory: MemoryRecord) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");

  const searchTerm = normalize(query);
  const filtered = searchTerm
    ? memories.filter((memory) =>
        [memory.content, memory.evidenceQuote, groupLabels[memory.kind]]
          .join(" ")
          .toLocaleLowerCase()
          .includes(searchTerm),
      )
    : memories;
  const groups = groupOrder
    .map((kind) => ({
      kind,
      items: filtered.filter((memory) => memory.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  const memoryCountBySource = new Map<string, number>();
  const notesBySource = new Map<string, UserNote[]>();
  for (const memory of memories) {
    memoryCountBySource.set(
      memory.sourceMessageId,
      (memoryCountBySource.get(memory.sourceMessageId) ?? 0) + 1,
    );
  }
  for (const note of notes) {
    const linked = notesBySource.get(note.sourceMessageId);
    if (linked) linked.push(note);
    else notesBySource.set(note.sourceMessageId, [note]);
  }

  async function save(memory: MemoryRecord) {
    const nextContent = content.trim();
    if (!nextContent) return;
    setPending(true);
    setActionError("");
    try {
      await onEdit(memory, nextContent);
      setEditing(null);
    } catch (reason) {
      setActionError(getErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  async function forget(memory: MemoryRecord) {
    setPending(true);
    setActionError("");
    try {
      await onDelete(memory);
      setForgetting(null);
    } catch (reason) {
      setActionError(getErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  async function retry() {
    if (!onRetry) return;
    setPending(true);
    setActionError("");
    try {
      await onRetry();
    } catch (reason) {
      setActionError(getErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="memory-scroll" aria-labelledby="memory-heading">
      <div className="memory-column">
        <header className="memory-heading">
          <div>
            <h1 id="memory-heading">Remembered context</h1>
            <p>
              Details Openmind may use to keep future conversations coherent.
              Review, correct, or forget any item here.
            </p>
          </div>
          <div
            className="memory-count"
            aria-label={`${memories.length} remembered ${memories.length === 1 ? "item" : "items"}`}
          >
            <strong>{memories.length}</strong>
            <span>{memories.length === 1 ? "item" : "items"}</span>
          </div>
        </header>

        <aside className="memory-boundary">
          <p>
            <strong>Your notes stay separate.</strong> Remembered context can
            influence future replies. Every item links to the message that
            supports it, though a source quote does not guarantee the wording is
            correct.
            {!sample &&
              " In the desktop app, this context is encrypted in your vault."}
          </p>
        </aside>

        {sample && (
          <p className="memory-disclosure">
            Browser demo · fictional context only. Changes reset when you close
            the demo. No new inference or storage happens in this sample.
          </p>
        )}

        {(error || actionError) && (
          <div className="memory-error" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <p>{actionError || error}</p>
            {error && onRetry && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void retry()}
                disabled={disabled || pending}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        )}

        <div className="memory-toolbar">
          <label className="memory-search" htmlFor="memory-search">
            <span className="sr-only">Search remembered context</span>
            <Search size={15} aria-hidden="true" />
            <input
              id="memory-search"
              type="search"
              placeholder="Search remembered context"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={loading || !memories.length}
            />
          </label>
          <span className="memory-result-count">
            {searchTerm ? `${filtered.length} matching` : "All items"}
          </span>
        </div>

        {loading ? (
          <div className="memory-loading" role="status" aria-live="polite">
            <span className="memory-loading-line" />
            <span className="memory-loading-line short" />
            <span className="memory-loading-line" />
            <span className="memory-loading-line medium" />
            <span>Loading remembered context…</span>
          </div>
        ) : !memories.length && !error ? (
          <div className="memory-empty">
            <div className="memory-empty-icon">
              <Brain size={28} aria-hidden="true" />
            </div>
            <h2>Nothing remembered yet</h2>
            <p>
              After a completed conversation, Openmind may save a small,
              source-linked detail here. You stay in control of what remains.
            </p>
          </div>
        ) : memories.length && !filtered.length ? (
          <div className="memory-empty compact">
            <div className="memory-empty-icon">
              <Search size={24} aria-hidden="true" />
            </div>
            <h2>No matches</h2>
            <p>Try another word or clear the search to see every item.</p>
            <button
              type="button"
              className="text-button"
              onClick={() => setQuery("")}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="memory-groups">
            {groups.map(({ kind, items }) => (
              <section
                className="memory-group"
                key={kind}
                aria-labelledby={`memory-group-${kind}`}
              >
                <div className="memory-group-heading">
                  <div className="memory-group-title">
                    <h2 id={`memory-group-${kind}`}>{groupLabels[kind]}</h2>
                  </div>
                  <span>{items.length}</span>
                </div>
                <div className="memory-list">
                  {items.map((memory) => {
                    const session = sessionsById.get(memory.sessionId);
                    const evidenceLabel =
                      evidenceLabels[memory.evidenceState] ?? "Source linked";
                    const sourceMemoryCount =
                      memoryCountBySource.get(memory.sourceMessageId) ?? 1;
                    const linkedNotes =
                      notesBySource.get(memory.sourceMessageId) ?? [];
                    const linkedNoteCount = linkedNotes.length;
                    return (
                      <article className="memory-card" key={memory.id}>
                        <div className="memory-card-topline">
                          <span className="memory-evidence-status">
                            {evidenceLabel}
                          </span>
                          <time
                            className="memory-date"
                            dateTime={memory.updatedAt || memory.createdAt}
                          >
                            <span className="sr-only">Last updated </span>
                            {formatDate(memory.updatedAt || memory.createdAt)}
                          </time>
                        </div>
                        {editing === memory.id ? (
                          <form
                            className="memory-editor-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void save(memory);
                            }}
                          >
                            <label
                              className="sr-only"
                              htmlFor={`memory-${memory.id}`}
                            >
                              Correct remembered context
                            </label>
                            <textarea
                              id={`memory-${memory.id}`}
                              className="memory-editor"
                              value={content}
                              onChange={(event) =>
                                setContent(event.target.value)
                              }
                              maxLength={600}
                              autoFocus
                              disabled={pending || disabled}
                            />
                            <div className="memory-actions">
                              <button
                                className="primary-button"
                                disabled={
                                  pending || disabled || !content.trim()
                                }
                              >
                                Save correction
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => setEditing(null)}
                                disabled={pending}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <p className="memory-content">{memory.content}</p>
                        )}

                        <div className="memory-evidence">
                          <div className="memory-evidence-heading">
                            <span>
                              <MessageSquareQuote
                                size={14}
                                aria-hidden="true"
                              />
                              Original source
                            </span>
                          </div>
                          <blockquote>“{memory.evidenceQuote}”</blockquote>
                          {memory.edited && (
                            <p className="memory-correction-note">
                              Edited by you. The source quote stays as it was
                              originally captured.
                            </p>
                          )}
                          <button
                            type="button"
                            className="memory-source"
                            onClick={() => {
                              setActionError("");
                              void onSource(memory).catch((reason: unknown) =>
                                setActionError(getErrorMessage(reason)),
                              );
                            }}
                            disabled={pending || disabled}
                          >
                            <ArrowUpRight size={14} aria-hidden="true" />
                            <span>
                              {session?.title || "View source conversation"}
                            </span>
                            <time
                              dateTime={session?.createdAt || memory.createdAt}
                            >
                              {formatDate(
                                session?.createdAt || memory.createdAt,
                              )}
                            </time>
                          </button>
                        </div>

                        {editing !== memory.id && (
                          <div className="memory-actions card-actions">
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setActionError("");
                                setEditing(memory.id);
                                setForgetting(null);
                                setContent(memory.content);
                              }}
                              disabled={pending || disabled}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Correct wording
                            </button>
                            <button
                              type="button"
                              className="text-button danger-text"
                              onClick={() => {
                                setActionError("");
                                setForgetting(memory.id);
                                setEditing(null);
                              }}
                              disabled={pending || disabled}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Forget
                            </button>
                          </div>
                        )}
                        {forgetting === memory.id && (
                          <div className="memory-forget-confirm">
                            <h3>Forget context from this message?</h3>
                            <p>
                              This removes {sourceMemoryCount} remembered{" "}
                              {sourceMemoryCount === 1 ? "item" : "items"}
                              {linkedNoteCount > 0 &&
                                ` and ${linkedNoteCount} linked ${linkedNoteCount === 1 ? "note" : "notes"}`}{" "}
                              from the original message and reply
                              {linkedNoteCount > 0 &&
                                ", including every linked note listed below and any wording you edited"}
                              . The transcript stays readable, but the original
                              message and reply will not be used for future
                              replies or notes. Existing backups and provider
                              copies are outside this action.
                            </p>
                            {linkedNotes.length > 0 && (
                              <>
                                <p className="memory-forget-scope">
                                  Linked notes included in this action
                                </p>
                                <ul
                                  className="memory-linked-notes"
                                  aria-label="Linked notes included in this action"
                                >
                                  {linkedNotes.map((note) => (
                                    <li key={note.id}>
                                      <span>{note.content}</span>
                                      {note.edited && (
                                        <span className="memory-note-edited">
                                          Edited by you
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                            <div className="memory-actions">
                              <button
                                type="button"
                                className="secondary-button danger-button"
                                onClick={() => void forget(memory)}
                                disabled={pending || disabled}
                              >
                                {pending
                                  ? "Forgetting…"
                                  : "Forget this context"}
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setForgetting(null)}
                                disabled={pending}
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
