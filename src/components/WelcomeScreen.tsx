import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  LockKeyhole,
  MessageSquare,
  Palette,
  ShieldCheck,
} from "lucide-react";
import { Mark } from "./Mark";

export function WelcomeScreen({
  screen,
  busy,
  error,
  passphrase,
  confirmation,
  onPassphraseChange,
  onConfirmationChange,
  onExploreSample,
  onUnlock,
  onRestore,
}: {
  screen: "loading" | "setup" | "locked" | "browser";
  busy: boolean;
  error: string;
  passphrase: string;
  confirmation: string;
  onPassphraseChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  onExploreSample: () => void;
  onUnlock: (event: FormEvent) => void;
  onRestore?: () => void;
}) {
  const [started, setStarted] = useState(false);
  const setup = screen === "setup" || screen === "browser";
  const showForm = screen === "locked" || (screen === "setup" && started);
  return (
    <main className="onboarding" aria-labelledby="welcome-title">
      <aside className="onboarding-rail">
        <div className="rail-brand">
          <Mark />
          <span>Openmind</span>
        </div>
        <div className="setup-progress" aria-label="Setup progress">
          <div className={`setup-step ${!started ? "current" : "complete"}`}>
            <span>{started ? <Check size={14} /> : "1"}</span>
            <div>
              <strong>Your workspace</strong>
              <small>A place to start</small>
            </div>
          </div>
          <div className={`setup-step ${started ? "current" : ""}`}>
            <span>2</span>
            <div>
              <strong>Keep it private</strong>
              <small>Protect your conversations</small>
            </div>
          </div>
          <div className="setup-step">
            <span>3</span>
            <div>
              <strong>Make a connection</strong>
              <small>Choose your AI model</small>
            </div>
          </div>
        </div>
        <p className="onboarding-rail-note">
          <LockKeyhole size={14} /> Your workspace. Your control.
        </p>
      </aside>
      <div className="onboarding-main">
        <div className="onboarding-topbar">
          <span>
            {screen === "locked" ? "Welcome back" : "Let’s get you settled"}
          </span>
          <span>Openmind</span>
        </div>
        <section className="onboarding-panel">
          {screen === "loading" ? (
            <p role="status">Opening your workspace…</p>
          ) : showForm ? (
            <>
              <div className="onboarding-symbol">
                <LockKeyhole size={23} strokeWidth={1.5} />
              </div>
              <h1 id="welcome-title">
                {setup ? "Create your private workspace." : "Welcome back."}
              </h1>
              <p className="onboarding-description">
                {setup
                  ? "Create a passphrase for your encrypted workspace. You’ll use it to unlock your conversations and notes."
                  : "Enter your passphrase to pick up where you left off."}
              </p>
              <form className="onboarding-form" onSubmit={onUnlock}>
                <label htmlFor="passphrase">
                  {setup ? "Create a passphrase" : "Passphrase"}
                </label>
                <input
                  id="passphrase"
                  type="password"
                  autoComplete={setup ? "new-password" : "current-password"}
                  value={passphrase}
                  onChange={(event) => onPassphraseChange(event.target.value)}
                  minLength={setup ? 12 : undefined}
                  required
                  disabled={busy}
                  autoFocus
                />
                {setup && (
                  <>
                    <p className="field-hint">
                      At least 12 characters. Keep a copy somewhere safe.
                    </p>
                    <label htmlFor="confirmation">Confirm passphrase</label>
                    <input
                      id="confirmation"
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(event) =>
                        onConfirmationChange(event.target.value)
                      }
                      required
                      disabled={busy}
                    />
                  </>
                )}
                {error && (
                  <div className="inline-error" role="alert">
                    <CircleAlert size={16} />
                    <span>{error}</span>
                  </div>
                )}
                <button className="primary-button wide" disabled={busy}>
                  {busy
                    ? "Opening…"
                    : setup
                      ? "Create workspace"
                      : "Unlock workspace"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <p className="onboarding-fineprint">
                {setup
                  ? "Your passphrase cannot be reset. Keep an encrypted backup so you have another way to restore your workspace."
                  : "Your conversations remain encrypted while your workspace is locked."}
              </p>
              {onRestore && (
                <button
                  className="text-button"
                  onClick={onRestore}
                  disabled={busy}
                >
                  Restore from a backup
                </button>
              )}
            </>
          ) : (
            <>
              <div className="onboarding-symbol">
                <MessageSquare size={24} strokeWidth={1.5} />
              </div>
              <h1 id="welcome-title">Welcome to Openmind.</h1>
              <p className="onboarding-description">
                Your conversations, notes, and remembered context. Let’s set up
                your workspace.
              </p>
              <div className="onboarding-features">
                <div>
                  <MessageSquare size={18} />
                  <span>
                    <strong>Continue a conversation</strong>
                    <small>Pick up where you left off.</small>
                  </span>
                </div>
                <div>
                  <ShieldCheck size={18} />
                  <span>
                    <strong>Decide what stays</strong>
                    <small>Review, correct, or forget saved context.</small>
                  </span>
                </div>
                <div>
                  <Palette size={18} />
                  <span>
                    <strong>Make it yours</strong>
                    <small>Choose your model and appearance.</small>
                  </span>
                </div>
              </div>
              <button
                className="primary-button wide"
                onClick={() =>
                  screen === "browser" ? onExploreSample() : setStarted(true)
                }
                disabled={busy}
              >
                {busy
                  ? "Opening…"
                  : screen === "browser"
                    ? "Explore the workspace"
                    : "Get started"}
                <ArrowRight size={16} />
              </button>
              {screen === "browser" ? (
                <p className="onboarding-fineprint">
                  Start with example conversations. This browser workspace
                  doesn’t save changes or connect a model; those features run in
                  the desktop app.
                </p>
              ) : (
                <>
                  <button
                    className="text-button onboarding-secondary"
                    onClick={onExploreSample}
                    disabled={busy}
                  >
                    Explore with example conversations
                  </button>
                  {onRestore && (
                    <button
                      className="text-button onboarding-secondary"
                      onClick={onRestore}
                      disabled={busy}
                    >
                      Restore a workspace
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>
        <footer className="onboarding-footer">
          <span>Conversations · Notes · Context</span>
          <span>Openmind</span>
        </footer>
      </div>
    </main>
  );
}
