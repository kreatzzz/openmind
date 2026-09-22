import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  MessageSquare,
  Plus,
} from "lucide-react";
import {
  desktop,
  type MemoryRecord,
  type Session,
  type SessionPlan,
  type UserNote,
} from "../lib/desktop";
import { readSamplePlans } from "../lib/plans";

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
  plansRevision = 0,
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
  plansRevision?: number;
}) {
  const [plans, setPlans] = useState<SessionPlan[]>([]);
  const [plansError, setPlansError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPlansError(false);
    const loading = sample
      ? Promise.resolve(readSamplePlans())
      : desktop.listPlans();
    void loading
      .then((value) => {
        if (!cancelled)
          setPlans(
            value
              .filter((plan) => plan.enabled)
              .sort((a, b) => a.nextAt.localeCompare(b.nextAt)),
          );
      })
      .catch(() => {
        if (!cancelled) setPlansError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sample, plansRevision]);
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
            {plans.length ? (
              <div className="upcoming-plans">
                {plans.slice(0, 3).map((plan) => (
                  <button
                    className="recent-row"
                    key={plan.id}
                    onClick={onPlans}
                  >
                    <CalendarDays size={18} />
                    <span>
                      <strong>{plan.label}</strong>
                      <small>
                        {new Date(plan.nextAt).toLocaleString(undefined, {
                          timeZone: plan.timezone,
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · {plan.timezone}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="plan-illustration" aria-hidden="true">
                  <span>SET YOUR OWN PACE</span>
                  <div>
                    <i /> <i /> <i className="today" /> <i /> <i /> <i /> <i />
                  </div>
                </div>
                <h3>
                  {plansError
                    ? "Your plans couldn't load."
                    : "Choose a time to check in."}
                </h3>
                <p>
                  {plansError
                    ? "Open planned sessions to try again."
                    : "Add a reminder for your next conversation, once or on a regular schedule."}
                </p>
              </>
            )}
            <button className="secondary-button wide" onClick={onPlans}>
              {plans.length || plansError ? "Manage plans" : "Plan a session"}{" "}
              <ArrowRight size={15} />
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
        ? "Changes stay in this browser tab"
        : "Conversations are encrypted in your workspace"}
    </span>
  );
}
