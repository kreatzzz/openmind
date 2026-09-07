import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  LockKeyhole,
  Menu,
  Plus,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { Dialog } from "./components/Dialog";
import { Mark } from "./components/Mark";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Transcript } from "./components/Transcript";
import {
  desktop,
  isDesktop,
  type Message,
  type ModelInfo,
  type Session,
  type TurnEvent,
} from "./lib/desktop";

type Screen = "loading" | "setup" | "locked" | "conversation" | "browser";
const SAMPLE_SESSION: Session = {
  id: "sample",
  title: "Making room for a slower week",
  createdAt: "2026-09-07T09:00:00Z",
  updatedAt: "2026-09-07T09:00:00Z",
};
const SAMPLE_MESSAGES: Message[] = [
  {
    id: "sample-1",
    sessionId: "sample",
    role: "user",
    content:
      "I had a quiet weekend, but by Sunday evening I was already making lists for the week. I think I turned resting into another thing to get right.",
    status: "complete",
    createdAt: SAMPLE_SESSION.createdAt,
  },
  {
    id: "sample-2",
    sessionId: "sample",
    role: "assistant",
    content:
      "It sounds like the planning followed you into the time you had set aside to rest.\n\nWhen you noticed yourself making those lists, what were you hoping they would help with?",
    status: "complete",
    createdAt: SAMPLE_SESSION.createdAt,
  },
  {
    id: "sample-3",
    sessionId: "sample",
    role: "user",
    content:
      "Probably feeling a little less behind. Even when there isn't anything urgent, I have that feeling.",
    status: "complete",
    createdAt: SAMPLE_SESSION.createdAt,
  },
];
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    isDesktop ? "loading" : "browser",
  );
  const [sample, setSample] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [settings, setSettings] = useState(false);
  const [notes, setNotes] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [connected, setConnected] = useState(false);
  const [fontSize, setFontSize] = useState(17);
  const [enterToSend, setEnterToSend] = useState(true);
  const [newReply, setNewReply] = useState(false);
  const generation = useRef(0);
  const connectionGeneration = useRef(0);
  const activeTurn = useRef(false);
  const stopRequested = useRef(false);
  const locking = useRef(false);
  const atBottom = useRef(true);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const session = sessions.find((item) => item.id === selected);

  async function loadSessions() {
    const request = generation.current;
    const list = await desktop.listSessions();
    const loaded = list[0] ? await desktop.listMessages(list[0].id) : [];
    if (request !== generation.current) return;
    setSessions(list);
    setSelected(list[0]?.id ?? null);
    setMessages(loaded);
    setScreen("conversation");
  }
  useEffect(() => {
    if (!isDesktop) return;
    let ignore = false;
    desktop
      .getVaultStatus()
      .then(async (status) => {
        if (ignore) return;
        if (status.unlocked) await loadSessions();
        else setScreen(status.exists ? "locked" : "setup");
      })
      .catch((reason) => {
        if (!ignore) {
          setError(errorText(reason));
          setScreen("locked");
        }
      });
    return () => {
      ignore = true;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (atBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
    else if (sending) setNewReply(true);
  }, [messages, sending]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 180)}px`;
    }
  }, [draft]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (screen === "setup" && passphrase !== confirmation) {
      setError("The passphrases do not match. Try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (screen === "setup") await desktop.createVault(passphrase);
      else await desktop.unlockVault(passphrase);
      setPassphrase("");
      setConfirmation("");
      await loadSessions();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  function exploreSample() {
    generation.current++;
    setSample(true);
    setSessions([SAMPLE_SESSION]);
    setSelected("sample");
    setMessages(SAMPLE_MESSAGES);
    setScreen("conversation");
    setError("");
  }
  function exitSample() {
    generation.current++;
    setSample(false);
    setMessages([]);
    setSessions([]);
    setSelected(null);
    setDraft("");
    setDrawer(false);
    setScreen(isDesktop ? "setup" : "browser");
  }
  async function selectSession(id: string) {
    if (sending || busy || id === selected) {
      setDrawer(false);
      return;
    }
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const loaded = await desktop.listMessages(id);
      if (generation.current === request) {
        setSelected(id);
        setMessages(loaded);
        setDraft("");
        atBottom.current = true;
        setNewReply(false);
        setDrawer(false);
      }
    } catch (reason) {
      if (generation.current === request) setError(errorText(reason));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  async function newSession() {
    if (sending || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const item = await desktop.createSession();
      if (request !== generation.current) return;
      setSessions((current) => [item, ...current]);
      setSelected(item.id);
      setMessages([]);
      setDraft("");
      setDrawer(false);
      setNewReply(false);
      atBottom.current = true;
      composer.current?.focus();
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function lock() {
    if (locking.current) return;
    locking.current = true;
    generation.current++;
    connectionGeneration.current++;
    setBusy(true);
    setError("");
    try {
      if (activeTurn.current) {
        try {
          await desktop.cancelTurn();
        } catch {
          /* Lock still needs to be attempted if cancellation fails. */
        }
      }
      await desktop.lockVault();
      activeTurn.current = false;
      stopRequested.current = false;
      setMessages([]);
      setSessions([]);
      setSelected(null);
      setDraft("");
      setPassphrase("");
      setConfirmation("");
      setError("");
      setConnectionError("");
      setConnected(false);
      setModels([]);
      setModel("");
      setAnnouncement("Vault locked.");
      setSettings(false);
      setNotes(false);
      setDrawer(false);
      setSending(false);
      setNewReply(false);
      setDiscovering(false);
      setScreen("locked");
    } catch {
      setError("The vault could not be locked. Try locking it again.");
    } finally {
      locking.current = false;
      setBusy(false);
      setSending(false);
    }
  }
  async function discoverModels() {
    const request = ++connectionGeneration.current;
    setDiscovering(true);
    setConnectionError("");
    setConnected(false);
    try {
      const result = await desktop.listModels(baseUrl);
      if (request !== connectionGeneration.current) return;
      setModels(result);
      setModel((current) =>
        result.some((item) => item.name === current)
          ? current
          : (result[0]?.name ?? ""),
      );
      setConnected(result.length > 0);
      if (!result.length)
        setConnectionError(
          "Ollama is reachable, but no models are installed. Install a model in Ollama, then check again.",
        );
    } catch (reason) {
      if (request === connectionGeneration.current) {
        setModels([]);
        setModel("");
        setConnectionError(errorText(reason));
      }
    } finally {
      if (request === connectionGeneration.current) setDiscovering(false);
    }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || activeTurn.current || busy || sample) return;
    if (!connected || !model) {
      setSettings(true);
      return;
    }
    activeTurn.current = true;
    stopRequested.current = false;
    setSending(true);
    setError("");
    setAnnouncement("Preparing a reply");
    const content = draft.trim();
    const request = generation.current;
    let received = false;
    let cancellationSent = false;
    setDraft("");
    const restoreDraft = () =>
      setDraft((current) => (current ? `${content}\n\n${current}` : content));
    try {
      let sessionId = selected;
      if (!sessionId) {
        const created = await desktop.createSession();
        if (request !== generation.current) return;
        sessionId = created.id;
        setSessions((current) => [created, ...current]);
        setSelected(sessionId);
      }
      if (stopRequested.current) {
        restoreDraft();
        setAnnouncement("Send canceled. Your message is back in the composer.");
        return;
      }
      atBottom.current = true;
      await desktop.sendMessage({
        sessionId,
        content,
        baseUrl,
        model,
        onEvent: (event: TurnEvent) => {
          if (generation.current !== request) return;
          if (event.type === "message") {
            if (stopRequested.current && !cancellationSent) {
              cancellationSent = true;
              void desktop.cancelTurn().catch((reason) => {
                if (generation.current === request) setError(errorText(reason));
              });
            }
            if (event.message.role === "user") received = true;
            setMessages((current) => [
              ...current.filter((item) => item.id !== event.message.id),
              event.message,
            ]);
          }
          if (event.type === "chunk")
            setMessages((current) =>
              current.map((item) =>
                item.id === event.messageId
                  ? { ...item, content: item.content + event.content }
                  : item,
              ),
            );
          if (event.type === "finished") {
            setMessages((current) =>
              current.map((item) =>
                item.id === event.messageId
                  ? { ...item, status: event.status }
                  : item,
              ),
            );
            setAnnouncement(
              event.status === "complete"
                ? "Reply complete."
                : "Reply stopped.",
            );
          }
          if (event.type === "error") {
            setError(event.message);
            setAnnouncement("The reply could not be completed.");
          }
        },
      });
    } catch (reason) {
      if (generation.current === request) {
        setError(errorText(reason));
        if (!received) restoreDraft();
      }
    } finally {
      if (generation.current === request) {
        try {
          const updatedSessions = await desktop.listSessions();
          if (generation.current === request) setSessions(updatedSessions);
        } catch {
          if (generation.current === request)
            setError(
              (current) =>
                current || "Conversation history could not be refreshed.",
            );
        }
      }
      if (generation.current === request) {
        activeTurn.current = false;
        setSending(false);
        setMessages((current) =>
          current.map((item) =>
            item.status === "streaming"
              ? { ...item, status: "interrupted" }
              : item,
          ),
        );
      }
    }
  }
  async function stop() {
    stopRequested.current = true;
    const request = generation.current;
    try {
      await desktop.cancelTurn();
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason));
    }
  }

  const rail = (
    <>
      <div className="rail-brand">
        <Mark />
        <span>openmind</span>
      </div>
      <div className="rail-topline">A little room to think.</div>
      <button
        className="new-conversation"
        onClick={sample ? exitSample : newSession}
        disabled={sending || busy}
      >
        <Plus size={18} />
        {sample ? "Leave sample" : "New conversation"}
      </button>
      <div className="history-label">
        CONVERSATIONS <span>{String(sessions.length).padStart(2, "0")}</span>
      </div>
      <nav className="session-list" aria-label="Conversations">
        {sessions.length ? (
          sessions.map((item) => (
            <button
              key={item.id}
              onClick={() => void selectSession(item.id)}
              className={`session-item ${selected === item.id ? "selected" : ""}`}
              aria-current={selected === item.id ? "page" : undefined}
              disabled={sending || busy}
            >
              <span>{item.title}</span>
              <small>{dateLabel(item.createdAt)}</small>
            </button>
          ))
        ) : (
          <p className="history-empty">
            Your conversations will
            <br />
            appear here.
          </p>
        )}
      </nav>
      {sending && (
        <p className="rail-hint">
          Stop the reply before switching conversations. Locking stops the
          reply.
        </p>
      )}
      <div className="rail-bottom">
        <button
          className="rail-action"
          onClick={() => {
            setNotes(true);
            setDrawer(false);
          }}
        >
          <BookOpen size={18} />
          Your notes
          <ChevronRight size={15} className="ml-auto" />
        </button>
        <div className="rail-divider" />
        <button
          className="rail-action"
          onClick={() => {
            setSettings(true);
            setDrawer(false);
          }}
          disabled={sending}
        >
          <Settings2 size={18} />
          Settings
        </button>
        {!sample && (
          <button
            className="rail-action"
            onClick={lock}
            disabled={locking.current}
          >
            <LockKeyhole size={17} />
            Lock vault
          </button>
        )}
        <div className="rail-footnote">
          <span className="status-dot" />
          {sample ? "Synthetic sample" : "Stored on this device"}
        </div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {screen === "conversation" ? (
        <>
          <aside className="desktop-rail">{rail}</aside>
          <main className="workspace">
            <header className="workspace-header">
              <div className="header-start">
                <button
                  className="icon-button mobile-menu"
                  aria-label="Open navigation"
                  onClick={() => setDrawer(true)}
                >
                  <Menu size={20} />
                </button>
                <span className="header-section">Conversation</span>
                <span className="header-slash">/</span>
                <span className="header-date">
                  {session ? dateLabel(session.createdAt) : "A fresh page"}
                </span>
              </div>
              <span className="preview-badge">Engineering preview</span>
            </header>
            {sample && (
              <div className="sample-banner">
                <span>
                  Sample conversation · Fictional text, no model connected
                </span>
                <button onClick={exitSample}>
                  Exit sample <ArrowRight size={14} />
                </button>
              </div>
            )}
            <Transcript
              messages={messages}
              session={session}
              sample={sample}
              fontSize={fontSize}
              scroll={scroll}
              onScroll={() => {
                const el = scroll.current;
                if (el) {
                  atBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                  if (atBottom.current) setNewReply(false);
                }
              }}
            />
            <div className="composer-region">
              <div className="composer-column">
                {newReply && (
                  <button
                    className="new-reply"
                    onClick={() => {
                      if (scroll.current)
                        scroll.current.scrollTop = scroll.current.scrollHeight;
                      atBottom.current = true;
                      setNewReply(false);
                    }}
                  >
                    New reply <ArrowDown size={14} />
                  </button>
                )}
                {error && (
                  <div className="inline-error" role="alert">
                    <CircleAlert size={17} />
                    <span>{error}</span>
                    <button
                      className="icon-button"
                      aria-label="Dismiss error"
                      onClick={() => setError("")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {sample ? (
                  <div className="sample-composer">
                    <span>
                      This is a sample to explore the reading experience.
                    </span>
                    <button className="text-button" onClick={exitSample}>
                      Back to setup <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <form className="composer" onSubmit={send}>
                    <label className="sr-only" htmlFor="message">
                      Your message
                    </label>
                    <textarea
                      ref={composer}
                      id="message"
                      rows={2}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="What's on your mind?"
                      disabled={busy}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing &&
                          event.keyCode !== 229 &&
                          (enterToSend
                            ? !event.shiftKey
                            : event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <div className="composer-toolbar">
                      <span>
                        {sending
                          ? "Generating a reply"
                          : enterToSend
                            ? "Shift + Enter for a new line"
                            : "Ctrl / ⌘ + Enter to send"}
                      </span>
                      {sending ? (
                        <button
                          className="send-button"
                          type="button"
                          aria-label="Stop reply"
                          onClick={stop}
                        >
                          <Square size={16} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          type="submit"
                          aria-label={
                            connected
                              ? "Send message"
                              : "Set up model connection"
                          }
                          disabled={!draft.trim() || busy}
                        >
                          <ArrowUp size={20} />
                        </button>
                      )}
                    </div>
                  </form>
                )}
                <div className="composer-footnote">
                  <span>
                    {sample ? (
                      "Nothing in this sample is saved."
                    ) : connected ? (
                      <>
                        <span className="status-dot" /> Ollama on loopback
                      </>
                    ) : (
                      <button onClick={() => setSettings(true)}>
                        Connect a local model <ArrowRight size={12} />
                      </button>
                    )}
                  </span>
                  <span>AI can make mistakes.</span>
                </div>
              </div>
            </div>
          </main>
          {drawer && (
            <Dialog title="Openmind" onClose={() => setDrawer(false)}>
              <div className="drawer-content">{rail}</div>
            </Dialog>
          )}
        </>
      ) : (
        <WelcomeScreen
          screen={screen}
          busy={busy}
          error={error}
          passphrase={passphrase}
          confirmation={confirmation}
          onPassphraseChange={setPassphrase}
          onConfirmationChange={setConfirmation}
          onExploreSample={exploreSample}
          onUnlock={unlock}
        />
      )}
      {settings && (
        <Dialog
          title="Make yourself comfortable"
          onClose={() => setSettings(false)}
        >
          <div className="settings-section">
            <div className="eyebrow">MODEL CONNECTION</div>
            <h3>Ollama on loopback</h3>
            <p>Model execution location unverified.</p>
            <p>
              Messages are sent to the configured Ollama endpoint. Only loopback
              addresses are supported in this prototype. Ollama may have its own
              logging and network settings.
            </p>
            <label htmlFor="endpoint">Local endpoint</label>
            <input
              id="endpoint"
              value={baseUrl}
              disabled={sample || discovering}
              onChange={(event) => {
                connectionGeneration.current++;
                setBaseUrl(event.target.value);
                setConnected(false);
                setModels([]);
                setModel("");
                setConnectionError("");
              }}
              spellCheck={false}
            />
            <button
              className="secondary-button"
              onClick={discoverModels}
              disabled={sample || discovering}
            >
              {discovering ? (
                "Checking connection…"
              ) : connected ? (
                <>
                  <Check size={16} /> Check again
                </>
              ) : (
                "Check connection"
              )}
            </button>
            {sample && (
              <p className="field-hint">
                Model connections are available in the desktop app. The sample
                does not send messages.
              </p>
            )}
            {connectionError && (
              <div className="inline-error" role="alert">
                <CircleAlert size={17} />
                <span>{connectionError}</span>
              </div>
            )}
            {models.length > 0 && (
              <>
                <label htmlFor="model">Model</label>
                <select
                  id="model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {models.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <div className="connection-success">
                  <Check size={15} /> Ollama is ready
                </div>
              </>
            )}
          </div>
          <div className="settings-section">
            <div className="eyebrow">READING & WRITING</div>
            <label htmlFor="text-size" className="setting-row">
              Conversation text <span>{fontSize}px</span>
            </label>
            <input
              id="text-size"
              type="range"
              min={16}
              max={22}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enterToSend}
                onChange={(event) => setEnterToSend(event.target.checked)}
              />
              Enter sends a message
            </label>
            <p className="field-hint">
              When off, use Ctrl / ⌘ + Enter to send.
            </p>
          </div>
          <p className="settings-footnote">
            These preferences last until you close the app.
          </p>
          <button
            className="primary-button wide"
            onClick={() => setSettings(false)}
          >
            Done
          </button>
        </Dialog>
      )}
      {notes && (
        <Dialog title="Your notes" onClose={() => setNotes(false)}>
          <div className="notes-empty">
            <BookOpen size={30} strokeWidth={1.25} />
            <h3>A place to return to.</h3>
            <p>Notes are not generated in this prototype.</p>
            <p className="field-hint">
              Future notes will link back to the conversation they came from.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
