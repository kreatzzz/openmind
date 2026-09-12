import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Brain,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  LockKeyhole,
  Menu,
  Plus,
  Settings2,
  Search,
  Trash2,
  Square,
  X,
} from "lucide-react";
import { Dialog } from "./components/Dialog";
import { Mark } from "./components/Mark";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Notebook } from "./components/Notebook";
import { MemoryWorkspace } from "./components/MemoryWorkspace";
import { Transcript } from "./components/Transcript";
import {
  desktop,
  isDesktop,
  type Message,
  type MemoryRecord,
  type ModelInfo,
  type Session,
  type TurnEvent,
  type UserNote,
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
  {
    id: "sample-4",
    sessionId: "sample",
    role: "assistant",
    content:
      "That feeling can make even a quiet week seem urgent. A little space may help you notice what actually needs your attention.",
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
  const [isDemo, setIsDemo] = useState(false);
  const [userNotes, setUserNotes] = useState<UserNote[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryError, setMemoryError] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [noteStatus, setNoteStatus] = useState("");
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(() => {
    try {
      return localStorage.getItem("openmind.appearance.v1") || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = appearance;
    try {
      localStorage.setItem("openmind.appearance.v1", appearance);
    } catch {
      /* Appearance is optional. */
    }
  }, [appearance]);
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
  const [memoryView, setMemoryView] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [deleteConversation, setDeleteConversation] = useState(false);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [provider, setProvider] = useState<"ollama" | "codex">("ollama");
  const [remoteConsent, setRemoteConsent] = useState(false);
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
    setMemoryLoading(true);
    const [sessionResult, noteResult, memoryResult] = await Promise.allSettled([
      desktop.listSessions(),
      desktop.listNotes(),
      desktop.listMemories(),
    ]);
    if (sessionResult.status === "rejected") throw sessionResult.reason;
    if (noteResult.status === "rejected") throw noteResult.reason;
    if (request !== generation.current) return;
    const list = sessionResult.value;
    const loadedNotes = noteResult.value;
    if (memoryResult.status === "fulfilled") {
      setMemories(memoryResult.value);
      setMemoryError("");
    } else {
      setMemories([]);
      setMemoryError(errorText(memoryResult.reason));
    }
    setMemoryLoading(false);
    const loaded = list[0] ? await desktop.listMessages(list[0].id) : [];
    if (request !== generation.current) return;
    setSessions(list);
    setUserNotes(loadedNotes);
    setSelected(list[0]?.id ?? null);
    setMessages(loaded);
    setScreen("conversation");
  }
  async function refreshMemories() {
    const request = generation.current;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const loaded = await desktop.listMemories();
      if (request === generation.current) setMemories(loaded);
    } catch (reason) {
      if (request === generation.current) {
        setMemoryError(errorText(reason));
        throw reason;
      }
    } finally {
      if (request === generation.current) setMemoryLoading(false);
    }
  }
  useEffect(() => {
    if (!isDesktop) return;
    let ignore = false;
    desktop
      .getVaultStatus()
      .then(async (status) => {
        if (ignore) return;
        setIsDemo(status.isDemo);
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
  async function exploreSample() {
    if (isDesktop) {
      setBusy(true);
      setError("");
      try {
        const status = await desktop.openDemo("demo", "openmind-demo-2026");
        setIsDemo(status.isDemo);
        await loadSessions();
        void discoverModels();
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setBusy(false);
      }
      return;
    }
    generation.current++;
    setSample(true);
    setIsDemo(true);
    setUserNotes([
      {
        id: "sample-note",
        sessionId: "sample",
        sourceMessageId: "sample-1",
        kind: "takeaway",
        content: "Rest can start to feel like another task to get right.",
        evidenceQuote:
          "I think I turned resting into another thing to get right.",
        revision: 1,
        edited: false,
        createdAt: SAMPLE_SESSION.createdAt,
        updatedAt: SAMPLE_SESSION.createdAt,
      },
    ]);
    setMemories([
      {
        id: "sample-memory-event",
        sessionId: "sample",
        sourceMessageId: "sample-1",
        assistantMessageId: "sample-2",
        kind: "event",
        content:
          "A quiet weekend made room to notice how planning follows rest.",
        evidenceQuote:
          "I had a quiet weekend, but by Sunday evening I was already making lists for the week.",
        evidenceState: "user_reported",
        revision: 1,
        edited: false,
        createdAt: SAMPLE_SESSION.createdAt,
        updatedAt: SAMPLE_SESSION.createdAt,
      },
      {
        id: "sample-memory-concern",
        sessionId: "sample",
        sourceMessageId: "sample-1",
        assistantMessageId: "sample-2",
        kind: "concern",
        content: "Rest can start to feel like another task to get right.",
        evidenceQuote:
          "I think I turned resting into another thing to get right.",
        evidenceState: "user_reported",
        revision: 1,
        edited: false,
        createdAt: SAMPLE_SESSION.createdAt,
        updatedAt: SAMPLE_SESSION.createdAt,
      },
      {
        id: "sample-memory-goal",
        sessionId: "sample",
        sourceMessageId: "sample-3",
        assistantMessageId: "sample-4",
        kind: "goal",
        content: "Feel a little less behind when the week is quiet.",
        evidenceQuote: "Probably feeling a little less behind.",
        evidenceState: "inferred",
        revision: 1,
        edited: false,
        createdAt: SAMPLE_SESSION.createdAt,
        updatedAt: SAMPLE_SESSION.createdAt,
      },
    ]);
    setSessions([SAMPLE_SESSION]);
    setSelected("sample");
    setMessages(SAMPLE_MESSAGES);
    setScreen("conversation");
    setError("");
  }
  function exitSample() {
    generation.current++;
    changeProvider("ollama");
    setSample(false);
    setIsDemo(false);
    setNotes(false);
    setUserNotes([]);
    setMemories([]);
    setMemoryError("");
    setMemoryLoading(false);
    setSearch("");
    setMessages([]);
    setSessions([]);
    setSelected(null);
    setDraft("");
    setDrawer(false);
    setSettings(false);
    setHighlight(null);
    setScreen(isDesktop ? "setup" : "browser");
  }
  async function selectSession(id: string) {
    setNotes(false);
    setMemoryView(false);
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
      setNotes(false);
      setMemoryView(false);
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
      setIsDemo(false);
      setUserNotes([]);
      setMemories([]);
      setMemoryError("");
      setMemoryLoading(false);
      setSearch("");
      setNoteStatus("");
      setHighlight(null);
      setSessions([]);
      setSelected(null);
      setDraft("");
      setPassphrase("");
      setConfirmation("");
      setError("");
      setConnectionError("");
      setProvider("ollama");
      setRemoteConsent(false);
      setConnected(false);
      setModels([]);
      setModel("");
      setAnnouncement("Vault locked.");
      setSettings(false);
      setNotes(false);
      setMemoryView(false);
      setDeleteConversation(false);
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
  async function removeConversation() {
    if (!selected || sending || busy || sample) return;
    const request = ++generation.current;
    const id = selected;
    setBusy(true);
    setError("");
    try {
      await desktop.deleteSession(id);
      if (request !== generation.current) return;
      setSessions((items) => items.filter((item) => item.id !== id));
      setUserNotes((items) => items.filter((item) => item.sessionId !== id));
      setMemories((items) => items.filter((item) => item.sessionId !== id));
      setSelected(null);
      setMessages([]);
      setDraft("");
      setHighlight(null);
      setNoteStatus("");
      setDeleteConversation(false);
      setAnnouncement("Conversation deleted.");
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function editMemory(memory: MemoryRecord, content: string) {
    const request = generation.current;
    const updated = sample
      ? {
          ...memory,
          content,
          evidenceState: "user_confirmed" as const,
          edited: true,
          revision: memory.revision + 1,
        }
      : await desktop.editMemory(memory.id, content, memory.revision);
    if (request !== generation.current) return;
    setMemories((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
  }
  async function forgetMemory(memory: MemoryRecord) {
    if (sending || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setMemoryError("");
    try {
      if (sample) {
        setMemories((items) =>
          items.filter(
            (item) => item.sourceMessageId !== memory.sourceMessageId,
          ),
        );
        setUserNotes((items) =>
          items.filter(
            (item) => item.sourceMessageId !== memory.sourceMessageId,
          ),
        );
      } else {
        await desktop.deleteMemory(memory.id, memory.revision);
        if (request !== generation.current) return;
        setMemories((items) =>
          items.filter(
            (item) => item.sourceMessageId !== memory.sourceMessageId,
          ),
        );
        setUserNotes((items) =>
          items.filter(
            (item) => item.sourceMessageId !== memory.sourceMessageId,
          ),
        );
        try {
          const [updatedMemories, updatedNotes] = await Promise.all([
            desktop.listMemories(),
            desktop.listNotes(),
          ]);
          if (request !== generation.current) return;
          setMemories(updatedMemories);
          setUserNotes(updatedNotes);
        } catch (reason) {
          if (request === generation.current)
            setMemoryError(
              `Remembered context was forgotten, but the list could not refresh: ${errorText(reason)}`,
            );
        }
      }
      setAnnouncement("Remembered context forgotten.");
    } catch (reason) {
      if (request === generation.current) {
        setMemoryError(errorText(reason));
        throw reason;
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function openMemorySource(memory: MemoryRecord) {
    const request = generation.current;
    atBottom.current = false;
    setNewReply(false);
    if (memory.sessionId !== selected) {
      setBusy(true);
      try {
        const loaded = sample
          ? SAMPLE_MESSAGES
          : await desktop.listMessages(memory.sessionId);
        if (request !== generation.current) return;
        setSelected(memory.sessionId);
        setMessages(loaded);
        setDraft("");
      } finally {
        if (request === generation.current) setBusy(false);
      }
    }
    if (request === generation.current) {
      setNotes(false);
      setMemoryView(false);
      setHighlight(memory.sourceMessageId);
    }
  }
  function changeProvider(next: "ollama" | "codex") {
    connectionGeneration.current++;
    setProvider(next);
    setRemoteConsent(false);
    setModels([]);
    setModel("");
    setConnected(false);
    setDiscovering(false);
    setConnectionError("");
  }
  async function discoverModels() {
    const request = ++connectionGeneration.current;
    setDiscovering(true);
    setConnectionError("");
    setConnected(false);
    try {
      const result =
        provider === "codex"
          ? await desktop.listCodexModels()
          : await desktop.listModels(baseUrl);
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
          provider === "codex"
            ? "No Codex models are available. Check your ChatGPT access in Codex and try again."
            : "Ollama is reachable, but no models are installed. Install a model in Ollama, then check again.",
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
    if (
      !connected ||
      !model ||
      (provider === "codex" && (!isDemo || !remoteConsent))
    ) {
      setSettings(true);
      return;
    }
    activeTurn.current = true;
    stopRequested.current = false;
    setSending(true);
    setError("");
    setAnnouncement("Preparing a reply");
    setNoteStatus("");
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
        provider,
        remoteConsent,
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
          if (event.type === "notes") {
            if (event.status === "updating" && stopRequested.current) {
              void desktop.cancelTurn().catch((reason) => {
                if (generation.current === request) setError(errorText(reason));
              });
            }
            const status =
              event.status === "updating"
                ? "Updating notes"
                : event.status === "complete"
                  ? "Notes updated"
                  : event.message ||
                    "Notes could not be updated. Your reply is saved.";
            setNoteStatus(status);
            setAnnouncement(status);
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
          const [updatedSessions, updatedNotes] = await Promise.all([
            desktop.listSessions(),
            desktop.listNotes(),
          ]);
          if (generation.current === request) {
            setSessions(updatedSessions);
            setUserNotes(updatedNotes);
          }
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
  async function updateNotes() {
    const reply = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" && message.status === "complete",
      );
    if (!reply || activeTurn.current || busy || sample) return;
    if (
      !connected ||
      !model ||
      (provider === "codex" && (!isDemo || !remoteConsent))
    ) {
      setSettings(true);
      return;
    }
    const request = generation.current;
    activeTurn.current = true;
    stopRequested.current = false;
    setSending(true);
    setNoteStatus("Updating notes");
    setError("");
    try {
      await desktop.retryNotes({
        messageId: reply.id,
        baseUrl,
        model,
        provider,
        remoteConsent,
        onEvent: (event) => {
          if (request !== generation.current) return;
          if (event.type === "notes") {
            setNoteStatus(
              event.status === "updating"
                ? "Updating notes"
                : event.status === "complete"
                  ? "Notes updated"
                  : event.message || "Notes could not be updated. Try again.",
            );
            if (stopRequested.current)
              void desktop.cancelTurn().catch(() => {});
          }
          if (event.type === "error") setError(event.message);
        },
      });
      const updated = await desktop.listNotes();
      if (request === generation.current) setUserNotes(updated);
    } catch (reason) {
      if (request === generation.current) setNoteStatus(errorText(reason));
    } finally {
      if (request === generation.current) {
        activeTurn.current = false;
        setSending(false);
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
        <span>Openmind</span>
      </div>
      <div className="rail-topline">
        {isDemo ? "Demo workspace" : "Personal workspace"}
      </div>
      <button
        className="new-conversation"
        onClick={sample ? exitSample : newSession}
        disabled={sending || busy}
      >
        <Plus size={18} />
        {sample ? "Close demo" : "New conversation"}
      </button>
      <div className="session-search">
        <Search size={15} />
        <input
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="history-label">
        CONVERSATIONS <span>{String(sessions.length).padStart(2, "0")}</span>
      </div>
      <nav className="session-list" aria-label="Conversations">
        {sessions.length ? (
          sessions
            .filter((item) =>
              item.title.toLowerCase().includes(search.toLowerCase()),
            )
            .map((item) => (
              <button
                key={item.id}
                onClick={() => void selectSession(item.id)}
                className={`session-item ${selected === item.id && !notes && !memoryView ? "selected" : ""}`}
                aria-current={
                  selected === item.id && !notes && !memoryView
                    ? "page"
                    : undefined
                }
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
          className={`rail-action ${memoryView ? "rail-action-selected" : ""}`}
          onClick={() => {
            setMemoryView(true);
            setNotes(false);
            setDrawer(false);
          }}
          aria-label="Remembered context"
          aria-current={memoryView ? "page" : undefined}
        >
          <Brain size={18} />
          Remembered context
          <span className="rail-count" aria-hidden="true">
            {memories.length}
          </span>
        </button>
        <button
          className={`rail-action ${notes ? "rail-action-selected" : ""}`}
          onClick={() => {
            setNotes(true);
            setMemoryView(false);
            setDrawer(false);
          }}
          aria-current={notes ? "page" : undefined}
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
        {sample ? (
          <button className="rail-action" onClick={exitSample}>
            <LockKeyhole size={17} />
            Close demo
          </button>
        ) : (
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
          {isDemo ? "Demo · synthetic data only" : "Stored on this device"}
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
                <span className="header-section">
                  {memoryView
                    ? "Remembered context"
                    : notes
                      ? "Your notes"
                      : "Conversation"}
                </span>
                <span className="header-slash">/</span>
                <span className="header-date">
                  {memoryView
                    ? `${memories.length} ${memories.length === 1 ? "item" : "items"}`
                    : session
                      ? dateLabel(session.createdAt)
                      : "A fresh page"}
                </span>
              </div>
              <div className="header-actions">
                <span className="preview-badge">Engineering preview</span>
                {!notes && !memoryView && selected && !sample && (
                  <button
                    className="icon-button"
                    aria-label="Delete conversation"
                    onClick={() => {
                      setError("");
                      setDeleteConversation(true);
                    }}
                    disabled={sending || busy}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </header>
            {isDemo && (
              <div className="sample-banner">
                <span>Demo workspace · Synthetic data only</span>
                <button onClick={sample ? exitSample : lock}>
                  Close demo <ArrowRight size={14} />
                </button>
              </div>
            )}
            {memoryView ? (
              <MemoryWorkspace
                memories={memories}
                notes={userNotes}
                sessions={sessions}
                sample={sample}
                disabled={sending || busy}
                loading={memoryLoading}
                error={memoryError}
                onRetry={sample ? undefined : refreshMemories}
                onEdit={editMemory}
                onDelete={forgetMemory}
                onSource={openMemorySource}
              />
            ) : notes ? (
              <Notebook
                notes={userNotes}
                sample={sample}
                disabled={sending || busy}
                onEdit={async (note, content) => {
                  const request = generation.current;
                  const updated = sample
                    ? {
                        ...note,
                        content,
                        edited: true,
                        revision: note.revision + 1,
                      }
                    : await desktop.editNote(note.id, content, note.revision);
                  if (request === generation.current)
                    setUserNotes((items) =>
                      items.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    );
                }}
                onDelete={async (note) => {
                  const request = generation.current;
                  if (!sample) await desktop.deleteNote(note.id, note.revision);
                  if (request === generation.current)
                    setUserNotes((items) =>
                      items.filter((item) => item.id !== note.id),
                    );
                }}
                onSource={async (note) => {
                  const request = generation.current;
                  atBottom.current = false;
                  setNewReply(false);
                  if (note.sessionId !== selected) {
                    setBusy(true);
                    try {
                      const loaded = await desktop.listMessages(note.sessionId);
                      if (request !== generation.current) return;
                      setSelected(note.sessionId);
                      setMessages(loaded);
                      setDraft("");
                    } finally {
                      if (request === generation.current) setBusy(false);
                    }
                  }
                  if (request === generation.current) {
                    setNotes(false);
                    setMemoryView(false);
                    setHighlight(note.sourceMessageId);
                  }
                }}
              />
            ) : (
              <>
                <Transcript
                  highlight={highlight}
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
                            scroll.current.scrollTop =
                              scroll.current.scrollHeight;
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
                          Explore the conversation, then edit a takeaway in Your
                          notes.
                        </span>
                        <button className="text-button" onClick={exitSample}>
                          Close demo <ArrowRight size={16} />
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
                              ? noteStatus === "Updating notes"
                                ? "Updating notes"
                                : "Generating a reply"
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
                                connected &&
                                (provider !== "codex" || remoteConsent)
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
                    <div className="notes-update-row">
                      {noteStatus && (
                        <p className="note-status">{noteStatus}</p>
                      )}
                      {!sample &&
                        messages.some(
                          (message) =>
                            message.role === "assistant" &&
                            message.status === "complete",
                        ) && (
                          <button
                            className="text-button"
                            onClick={updateNotes}
                            disabled={sending || busy}
                          >
                            Update notes
                          </button>
                        )}
                    </div>
                    <div className="composer-footnote">
                      <span>
                        {sample ? (
                          "Browser demo · No inference or storage"
                        ) : connected ? (
                          <>
                            <span className="status-dot" />{" "}
                            {provider === "codex"
                              ? "Online · ChatGPT via Codex"
                              : "Ollama on loopback"}
                          </>
                        ) : (
                          <button onClick={() => setSettings(true)}>
                            {provider === "codex"
                              ? "Set up ChatGPT connection"
                              : "Connect a local model"}{" "}
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </span>
                      <span>AI can make mistakes.</span>
                    </div>
                  </div>
                </div>
              </>
            )}
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
      {deleteConversation && (
        <Dialog
          title="Delete conversation?"
          onClose={() => {
            if (!busy) setDeleteConversation(false);
          }}
        >
          <p className="deletion-description">
            This removes the transcript and its generated notes and internal
            memory from this vault. This cannot be undone.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="note-actions">
            <button
              className="secondary-button"
              disabled={busy}
              autoFocus
              onClick={() => setDeleteConversation(false)}
            >
              Keep conversation
            </button>
            <button
              className="primary-button"
              disabled={busy || sending}
              onClick={removeConversation}
            >
              {busy ? "Deleting…" : "Delete conversation"}
            </button>
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog title="Settings" onClose={() => setSettings(false)}>
          <div className="settings-section">
            <div className="eyebrow">MODEL CONNECTION</div>
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={provider}
              disabled={sample || sending}
              onChange={(event) =>
                changeProvider(
                  event.target.value === "codex" && isDemo && !sample
                    ? "codex"
                    : "ollama",
                )
              }
            >
              <option value="ollama">Local Ollama</option>
              {isDemo && !sample && (
                <option value="codex">ChatGPT via Codex</option>
              )}
            </select>
            {provider === "codex" ? (
              <>
                <h3>ChatGPT via Codex · Online</h3>
                <p>
                  Uses the ChatGPT account signed in to Codex on this device.
                  Subscription limits apply. Available for synthetic demo
                  testing only.
                </p>
                <p>
                  This sends demo messages, recent conversation context,
                  internal memory, and the source for note updates to OpenAI.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={remoteConsent}
                    disabled={sending}
                    onChange={(event) => setRemoteConsent(event.target.checked)}
                  />
                  I agree to send this demo context to OpenAI.
                </label>
                <p className="field-hint">
                  If signed out, run <code>codex login</code> in a terminal,
                  then check the connection.
                </p>
              </>
            ) : (
              <>
                <h3>Ollama on loopback</h3>
                <p>Model execution location unverified.</p>
                <p>
                  Messages are sent to the configured Ollama endpoint. Only
                  loopback addresses are supported in this prototype. Ollama may
                  have its own logging and network settings.
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
              </>
            )}
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
                  <Check size={15} />{" "}
                  {provider === "codex"
                    ? "ChatGPT via Codex is ready"
                    : "Ollama is ready"}
                </div>
              </>
            )}
          </div>
          <div className="settings-section">
            <div className="eyebrow">APPEARANCE</div>
            <label htmlFor="appearance">Theme</label>
            <select
              id="appearance"
              value={appearance}
              onChange={(event) => setAppearance(event.target.value)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <div className="eyebrow reading-heading">READING & WRITING</div>
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
            Theme is saved on this device. Reading preferences last until you
            close the app.
          </p>
          <button
            className="primary-button wide"
            onClick={() => setSettings(false)}
          >
            Done
          </button>
        </Dialog>
      )}
    </div>
  );
}
