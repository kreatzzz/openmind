import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  MessageSquare,
  Plus,
} from "lucide-react";
import type { MemoryRecord, Session, UserNote } from "../lib/desktop";

export function HomeWorkspace({
  sessions,
  notes,
  memories,
  onNew,
  onSession,
  onNotes,
  onMemory,
  onPlans,
  disabled,
  sample,
}: {
  sessions: Session[];
  notes: UserNote[];
  memories: MemoryRecord[];
  onNew: () => void;
  onSession: (id: string) => void;
  onNotes: () => void;
  onMemory: () => void;
  onPlans: () => void;
  disabled: boolean;
  sample: boolean;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? "Good morning."
      : hour < 18
        ? "Good afternoon."
        : "Good evening.";
  return (
    <div className="home-scroll">
      <div className="home-workspace">
        <div className="home-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1>{greeting}</h1>
            <p>Continue a conversation or start a new one.</p>
          </div>
          <button
            className="primary-button"
            onClick={onNew}
            disabled={disabled}
          >
            <Plus size={16} /> New conversation
          </button>
        </div>
        <div className="home-grid">
          <section className="home-section recent-section">
            <div className="section-title">
              <h2>Pick up a conversation</h2>
              <span className="quiet-count">{sessions.length}</span>
            </div>
            {sessions.length ? (
              <div className="recent-list">
                {sessions.slice(0, 4).map((session) => (
                  <button
                    key={session.id}
                    className="recent-row"
                    onClick={() => onSession(session.id)}
                    disabled={disabled}
                  >
                    <span className="row-icon">
                      <MessageSquare size={18} />
                    </span>
                    <span>
                      <strong>{session.title}</strong>
                      <small>
                        {new Date(session.updatedAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        )}{" "}
                        ·{" "}
                        {session.memoryEnabled
                          ? "Context enabled"
                          : "Context off"}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="home-empty">
                <MessageSquare size={24} />
                <h3>Your first conversation starts here</h3>
                <p>
                  Write about your day, ask a question, or work through a
                  thought.
                </p>
                <button className="text-button" onClick={onNew}>
                  Start a conversation <ArrowRight size={14} />
                </button>
              </div>
            )}
            <div className="home-section-footer">
              <LockCaption sample={sample} />
            </div>
          </section>
          <section className="home-section plan-section">
            <div className="section-title">
              <h2>Planned sessions</h2>
              <CalendarDays size={17} />
            </div>
            <div className="plan-illustration" aria-hidden="true">
              <span>SET YOUR OWN PACE</span>
              <div>
                <i /> <i /> <i className="today" /> <i /> <i /> <i /> <i />
              </div>
            </div>
            <h3>Choose a time to check in.</h3>
            <p>
              Add a reminder for your next conversation, once or on a regular
              schedule.
            </p>
            <button className="secondary-button wide" onClick={onPlans}>
              Plan a session <ArrowRight size={15} />
            </button>
          </section>
          <section className="home-section notes-section">
            <div className="section-title">
              <h2>
                <BookOpen size={17} /> Your notes
              </h2>
              <button className="text-button" onClick={onNotes}>
                View all <ArrowRight size={14} />
              </button>
            </div>
            {notes.length ? (
              notes.slice(0, 2).map((note) => (
                <button key={note.id} className="home-note" onClick={onNotes}>
                  <span className="eyebrow">
                    {note.kind.replaceAll("_", " ")}
                  </span>
                  <p>{note.content}</p>
                  <small>
                    {new Date(note.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </button>
              ))
            ) : (
              <div className="home-empty compact">
                <p>
                  Useful takeaways from your conversations will appear here. You
                  can edit them at any time.
                </p>
              </div>
            )}
          </section>
          <section className="home-section memory-section">
            <div className="section-title">
              <h2>
                <Brain size={17} /> Remembered context
              </h2>
              <span className="quiet-count">{memories.length}</span>
            </div>
            <p className="section-description">
              The details that help a conversation continue.
            </p>
            <div className="memory-preview">
              {memories.slice(0, 3).map((memory) => (
                <button key={memory.id} onClick={onMemory}>
                  <span className="memory-dot" />
                  <span>{memory.content}</span>
                </button>
              ))}
              {!memories.length && (
                <p>
                  When you choose to save context, you’ll be able to review it
                  here.
                </p>
              )}
            </div>
            <div className="home-section-footer">
              <button className="text-button" onClick={onMemory}>
                Manage remembered context <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LockCaption({ sample }: { sample: boolean }) {
  return (
    <span>
      {sample
        ? "Example conversations · changes stay in this browser tab"
        : "Conversations are encrypted in your workspace"}
    </span>
  );
}
