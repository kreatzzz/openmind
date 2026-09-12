import type { FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  LockKeyhole,
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
}) {
  return (
    <main className="welcome-screen">
      <header className="welcome-header">
        <div className="rail-brand">
          <Mark />
          <span>Openmind</span>
        </div>
        <span className="preview-badge">Engineering preview</span>
      </header>
      <div className="welcome-body">
        <div className="welcome-copy">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Welcome to Openmind</h1>
          <p>Conversations and notes, together on your device.</p>
        </div>
        <section className="vault-panel">
          {screen === "loading" ? (
            <p role="status">Opening Openmind…</p>
          ) : screen === "browser" ? (
            <>
              <span className="panel-icon">
                <BookOpen size={23} strokeWidth={1.5} />
              </span>
              <h2>Try the demo</h2>
              <p>
                Explore a fictional conversation and get a feel for Openmind.
              </p>
              <button className="primary-button wide" onClick={onExploreSample}>
                Open demo <ArrowRight size={17} />
              </button>
              <div className="panel-note">
                <ShieldCheck size={18} />
                <p>
                  The desktop app connects to local Ollama and stores
                  conversations in an encrypted vault. This browser preview has
                  no model connection or storage.
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="panel-icon">
                <LockKeyhole size={23} strokeWidth={1.5} />
              </span>
              <h2>
                {screen === "setup"
                  ? "Create your vault"
                  : "Unlock your workspace"}
              </h2>
              <p>
                {screen === "setup"
                  ? "Create a passphrase to protect the conversations saved on this device."
                  : "Unlock your vault to return to your conversations."}
              </p>
              <form onSubmit={onUnlock}>
                <label htmlFor="passphrase">
                  {screen === "setup"
                    ? "Create a passphrase"
                    : "Your passphrase"}
                </label>
                <input
                  id="passphrase"
                  type="password"
                  autoComplete={
                    screen === "setup" ? "new-password" : "current-password"
                  }
                  value={passphrase}
                  onChange={(event) => onPassphraseChange(event.target.value)}
                  minLength={screen === "setup" ? 12 : undefined}
                  required
                  disabled={busy}
                />
                {screen === "setup" && (
                  <>
                    <span className="field-hint">
                      At least 12 characters. Keep it somewhere safe.
                    </span>
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
                    <CircleAlert size={17} />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  type="submit"
                  className="primary-button wide"
                  disabled={busy}
                >
                  {busy
                    ? "Opening your vault…"
                    : screen === "setup"
                      ? "Create your vault"
                      : "Unlock your vault"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <div className="demo-entry">
                <p>
                  Just exploring? Start with fictional conversations and
                  editable notes.
                </p>
                <button
                  className="secondary-button wide"
                  onClick={onExploreSample}
                  disabled={busy}
                >
                  Open demo <ArrowRight size={16} />
                </button>
                <span className="field-hint">
                  No personal account needed. Demo login: <code>demo</code>
                </span>
              </div>
              <div className="panel-note">
                <ShieldCheck size={18} />
                <p>
                  {screen === "setup"
                    ? "Your passphrase cannot be recovered. The next step is connecting a local model."
                    : "Your conversations stay hidden here until you unlock."}
                </p>
              </div>
            </>
          )}
        </section>
      </div>
      <footer className="welcome-footer">
        <span>Openmind desktop preview</span>
        <span>Experimental software. Not evaluated clinical care.</span>
      </footer>
    </main>
  );
}
