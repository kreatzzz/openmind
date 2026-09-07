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
          <span>openmind</span>
        </div>
        <span className="preview-badge">Engineering preview</span>
      </header>
      <div className="welcome-body">
        <div className="welcome-copy">
          <div className="eyebrow">
            <span className="margin-line" />A SPACE FOR REFLECTION
          </div>
          <h1>
            A little room
            <br />
            for what's on
            <br />
            <em>your mind.</em>
          </h1>
          <p>
            A private place to put thoughts into words.
            <br />
            One conversation at a time.
          </p>
          <div className="welcome-rule" />
          <span className="welcome-caption">
            Built for your device. At your own pace.
          </span>
        </div>
        <section className="vault-panel">
          {screen === "loading" ? (
            <p role="status">Opening Openmind…</p>
          ) : screen === "browser" ? (
            <>
              <span className="panel-icon">
                <BookOpen size={23} strokeWidth={1.5} />
              </span>
              <h2>Take a look around.</h2>
              <p>
                Explore a fictional conversation and get a feel for Openmind.
              </p>
              <button className="primary-button wide" onClick={onExploreSample}>
                Explore a sample <ArrowRight size={17} />
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
                  ? "Make this space yours."
                  : "Welcome back."}
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
        <span>
          OPENMIND <span className="footer-divider">/</span> EARLY EXPLORATIONS
        </span>
        <span>Experimental software. Not evaluated clinical care.</span>
      </footer>
    </main>
  );
}
