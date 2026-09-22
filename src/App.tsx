import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Brain,
  CalendarDays,
  House,
  Palette,
  Shield,
  Plug,
  BookOpen,
  ChevronRight,
  CircleAlert,
  LockKeyhole,
  Menu,
  Plus,
  SlidersHorizontal,
  Settings2,
  Search,
  Ghost,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "./components/Dialog";
import { ConversationControls } from "./components/ConversationControls";
import { Mark } from "./components/Mark";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Notebook } from "./components/Notebook";
import { MemoryWorkspace } from "./components/MemoryWorkspace";
import { Transcript } from "./components/Transcript";
import { ChatComposer } from "./components/ChatComposer";
import { DictationControl } from "./components/DictationControl";
import { HomeWorkspace } from "./components/HomeWorkspace";
import { PlannedSessions } from "./components/PlannedSessions";
import { PrivacySettings } from "./components/PrivacySettings";
import { RestoreWorkspace } from "./components/RestoreWorkspace";
import { ProviderSettingsPanel } from "./components/ProviderSettingsPanel";
import { MemoryIndexSettings } from "./components/MemoryIndexSettings";
import { resetSamplePlans } from "./lib/plans";
import { useLocalDictation } from "./hooks/useLocalDictation";
import {
  AppearanceSettings,
  COLOR_THEMES,
} from "./components/AppearanceSettings";
import {
  desktop,
  isDesktop,
  type Message,
  type MemoryRecord,
  type ProviderKind,
  type ProviderSettings,
  type ReadingSettings,
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
  revision: 1,
  memoryEnabled: true,
  notesEnabled: true,
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
const scheduleAnimationFrame = (callback: FrameRequestCallback) =>
  typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 16);
const cancelScheduledAnimationFrame = (handle: number) => {
  if (typeof window.cancelAnimationFrame === "function")
    window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
};
function setThemeAttribute(name: "theme" | "color", value: string) {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(style);
  document.documentElement.dataset[name] = value;
  void document.documentElement.offsetHeight;
  requestAnimationFrame(() => style.remove());
}
const DEFAULT_READING: ReadingSettings = {
  textScalePercent: 100,
  lineWidth: "comfortable",
  reduceMotion: false,
  enterToSend: true,
  revision: 0,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    isDesktop ? "loading" : "browser",
  );
  const [sample, setSample] = useState(false);
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
    setThemeAttribute("theme", appearance);
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
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [settings, setSettings] = useState(false);
  const [settingsPage, setSettingsPage] = useState<
    "connection" | "appearance" | "privacy" | "memory"
  >("appearance");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [home, setHome] = useState(true);
  const [plansOpen, setPlansOpen] = useState(false);
  const [plansRevision, setPlansRevision] = useState(0);
  const [duePlan, setDuePlan] = useState<string | null>(null);
  const [colorTheme, setColorTheme] = useState(() => {
    try {
      const value = localStorage.getItem("openmind.color.v1");
      return COLOR_THEMES.some((theme) => theme.id === value)
        ? value!
        : "graphite";
    } catch {
      return "graphite";
    }
  });
  useEffect(() => {
    setThemeAttribute("color", colorTheme);
    try {
      localStorage.setItem("openmind.color.v1", colorTheme);
    } catch {
      /* Appearance works without storage. */
    }
  }, [colorTheme]);
  const [conversationControls, setConversationControls] = useState(false);
  const [notes, setNotes] = useState(false);
  const [memoryView, setMemoryView] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [deleteConversation, setDeleteConversation] = useState(false);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [provider, setProvider] = useState<ProviderKind>("ollama");
  const [remoteConsent, setRemoteConsent] = useState(false);
  const [model, setModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [reading, setReading] = useState<ReadingSettings>(DEFAULT_READING);
  const [readingError, setReadingError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.lineWidth = reading.lineWidth;
    document.documentElement.dataset.reduceMotion = String(
      reading.reduceMotion,
    );
  }, [reading.lineWidth, reading.reduceMotion]);
  const [newReply, setNewReply] = useState(false);
  const generation = useRef(0);
  const turnGeneration = useRef(0);
  const activeTurn = useRef(false);
  const stopRequested = useRef(false);
  const locking = useRef(false);
  const atBottom = useRef(true);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pendingChunks = useRef(new Map<string, string>());
  const chunkFlushFrame = useRef<number | null>(null);
  const draftsBySession = useRef(new Map<string, string>());
  const lastActivity = useRef(0);
  const fontSize = Math.round((17 * reading.textScalePercent) / 100);
  const enterToSend = reading.enterToSend;
  const session = sessions.find((item) => item.id === selected);
  const hasReplyContent = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "streaming" &&
      message.content.length > 0,
  );
  const dictationDisabled =
    busy ||
    sending ||
    sample ||
    screen !== "conversation" ||
    home ||
    notes ||
    memoryView ||
    settings ||
    plansOpen ||
    conversationControls ||
    deleteConversation ||
    restoreOpen ||
    drawer;
  const dictationSelection = useCallback(() => {
    const field = composer.current;
    return {
      start: field?.selectionStart ?? draft.length,
      end: field?.selectionEnd ?? draft.length,
    };
  }, [draft.length]);
  const dictation = useLocalDictation({
    language:
      typeof navigator === "undefined" || !navigator.language
        ? "en-US"
        : navigator.language.toLowerCase().startsWith("en")
          ? navigator.language
          : "en-US",
    value: draft,
    onValueChange: setDraftValue,
    selection: dictationSelection,
    sessionKey: selected,
    disabled: dictationDisabled,
  });

  function discardPendingChunks() {
    if (chunkFlushFrame.current !== null) {
      cancelScheduledAnimationFrame(chunkFlushFrame.current);
      chunkFlushFrame.current = null;
    }
    pendingChunks.current.clear();
  }

  function flushPendingChunks(request: number, turn: number) {
    if (chunkFlushFrame.current !== null) {
      cancelScheduledAnimationFrame(chunkFlushFrame.current);
      chunkFlushFrame.current = null;
    }
    const chunks = pendingChunks.current;
    pendingChunks.current = new Map();
    if (
      !chunks.size ||
      generation.current !== request ||
      turnGeneration.current !== turn
    )
      return;
    setMessages((current) =>
      current.map((item) => {
        const content = chunks.get(item.id);
        return content ? { ...item, content: item.content + content } : item;
      }),
    );
  }

  function queueChunk(
    messageId: string,
    content: string,
    request: number,
    turn: number,
  ) {
    pendingChunks.current.set(
      messageId,
      (pendingChunks.current.get(messageId) ?? "") + content,
    );
    if (chunkFlushFrame.current === null) {
      chunkFlushFrame.current = scheduleAnimationFrame(() =>
        flushPendingChunks(request, turn),
      );
    }
  }

  function setDraftValue(value: string, sessionId: string | null = selected) {
    setDraft(value);
    if (sessionId) draftsBySession.current.set(sessionId, value);
  }

  function rememberCurrentDraft() {
    if (selected) draftsBySession.current.set(selected, draft);
  }

  const sessionMemoryEnabled = session?.memoryEnabled !== false;
  const sessionNotesEnabled = session?.notesEnabled !== false;

  function derivationLabel(memoryEnabled: boolean, notesEnabled: boolean) {
    if (memoryEnabled && notesEnabled) return "notes";
    if (memoryEnabled) return "remembered context";
    if (notesEnabled) return "notes";
    return "";
  }

  function formatDerivationStatus(
    status: "updating" | "complete" | "failed" | "skipped",
    memoryEnabled: boolean,
    notesEnabled: boolean,
    message?: string,
  ) {
    const label = derivationLabel(memoryEnabled, notesEnabled);
    if (!label) return "";
    if (status === "skipped")
      return message || "No saved updates for this message.";
    if (status === "updating") return `Updating ${label}`;
    if (status === "complete")
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} updated`;
    if (message?.toLowerCase().startsWith("notes update stopped"))
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} update stopped. You can retry it.`;
    return message || `${label} could not be updated. Your reply is saved.`;
  }

  async function loadSessions() {
    const request = generation.current;
    setMemoryLoading(true);
    const [
      sessionResult,
      noteResult,
      memoryResult,
      providerResult,
      readingResult,
      healthResult,
    ] = await Promise.allSettled([
      desktop.listSessions(),
      desktop.listNotes(),
      desktop.listMemories(),
      desktop.getProviderSettings(),
      desktop.getReadingSettings(),
      desktop.checkProviderHealth(),
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
    if (providerResult.status === "fulfilled") {
      applyProviderSettings(
        providerResult.value,
        healthResult.status === "fulfilled" &&
          healthResult.value.status === "ready",
      );
    }
    if (readingResult.status === "fulfilled") setReading(readingResult.value);
    const loaded = list[0] ? await desktop.listMessages(list[0].id) : [];
    if (request !== generation.current) return;
    setSessions(list);
    setUserNotes(loadedNotes);
    setSelected(list[0]?.id ?? null);
    setMessages(loaded);
    setScreen("conversation");
    if (
      providerResult.status === "fulfilled" &&
      !providerResult.value.model.trim()
    ) {
      setSettingsPage("connection");
      setSettings(true);
    }
  }

  function applyProviderSettings(value: ProviderSettings, ready: boolean) {
    setProvider(value.provider);
    setBaseUrl(value.baseUrl);
    setModel(value.model);
    setRemoteConsent(value.remoteDataConsent);
    setConnected(ready);
  }
  async function saveReadingSettings(next: ReadingSettings) {
    setReading(next);
    setReadingError("");
    if (sample) return;
    try {
      const saved = await desktop.updateReadingSettings(next);
      setReading((current) =>
        current.revision > next.revision ? current : saved,
      );
    } catch (reason) {
      setReadingError(errorText(reason));
    }
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
  useEffect(() => discardPendingChunks, []);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    const unlisten = Promise.all([
      desktop.onVaultLocked(() => clearRendererForLock()),
      desktop.onPlannedSessionDue((plans) => {
        if (plans.length) setDuePlan("Your planned session is ready.");
      }),
    ]);
    return () => {
      disposed = true;
      void unlisten.then((callbacks) => {
        if (disposed) callbacks.forEach((callback) => callback());
      });
    };
  }, []);
  useEffect(() => {
    if (!isDesktop || sample || screen !== "conversation") return;
    const record = () => {
      const now = Date.now();
      if (now - lastActivity.current < 15_000) return;
      lastActivity.current = now;
      void desktop.recordActivity().catch(() => {});
    };
    const options = { passive: true } as const;
    window.addEventListener("pointerdown", record, options);
    window.addEventListener("keydown", record);
    window.addEventListener("focus", record);
    record();
    return () => {
      window.removeEventListener("pointerdown", record);
      window.removeEventListener("keydown", record);
      window.removeEventListener("focus", record);
    };
  }, [sample, screen]);
  useEffect(() => {
    if (!isDesktop || sample || screen !== "conversation") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    const schedule = (delay: number) => {
      if (!cancelled && consecutiveFailures < 4)
        timer = setTimeout(() => void inspect(), delay);
    };
    const inspect = async () => {
      if (cancelled) return;
      if (activeTurn.current || sending) {
        schedule(2_000);
        return;
      }
      try {
        const jobs = await desktop.listNoteJobs();
        if (cancelled) return;
        const retryable = jobs.filter(
          (job) =>
            (job.status === "pending" || job.status === "failed") &&
            job.attemptCount < 3,
        );
        if (!retryable.length) return;
        const dueAt = Math.min(
          ...retryable.map((job) =>
            job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : Date.now(),
          ),
        );
        const delay = Math.max(0, Math.min(30_000, dueAt - Date.now()));
        if (delay > 0) {
          schedule(delay);
          return;
        }
        await desktop.resumeNoteJobs((event) => {
          if (cancelled || event.type !== "notes") return;
          const status = formatDerivationStatus(
            event.status,
            event.memoryEnabled ?? true,
            event.notesEnabled ?? true,
            event.message,
          );
          setNoteStatus(status);
        });
        if (!cancelled) {
          const [loadedNotes, loadedMemories] = await Promise.all([
            desktop.listNotes(),
            desktop.listMemories(),
          ]);
          if (!cancelled) {
            setUserNotes(loadedNotes);
            setMemories(loadedMemories);
          }
        }
        consecutiveFailures = 0;
        schedule(2_000);
      } catch {
        consecutiveFailures += 1;
        schedule(Math.min(30_000, 2_000 * 2 ** (consecutiveFailures - 1)));
      }
    };
    void inspect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sample, screen, sending]);
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
    resetSamplePlans();
    setPlansRevision((value) => value + 1);
    if (isDesktop) {
      setBusy(true);
      setError("");
      try {
        await desktop.openDemo("demo", "openmind-demo-2026");
        await loadSessions();
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setBusy(false);
      }
      return;
    }
    generation.current++;
    setSample(true);
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
    resetSamplePlans();
    generation.current++;
    discardPendingChunks();
    setProvider("ollama");
    setBaseUrl("http://127.0.0.1:11434");
    setModel("");
    setRemoteConsent(false);
    setConnected(false);
    setSample(false);
    setConversationControls(false);
    setNotes(false);
    setUserNotes([]);
    setMemories([]);
    setMemoryError("");
    setMemoryLoading(false);
    setSearch("");
    setMessages([]);
    setSessions([]);
    setSelected(null);
    draftsBySession.current.clear();
    setDraftValue("", null);
    setDrawer(false);
    setSettings(false);
    setHighlight(null);
    setScreen(isDesktop ? "setup" : "browser");
  }
  async function selectSession(id: string) {
    setHome(false);
    rememberCurrentDraft();
    setNotes(false);
    setMemoryView(false);
    setConversationControls(false);
    setNoteStatus("");
    if (sending || busy || id === selected) {
      setDrawer(false);
      return;
    }
    const request = ++generation.current;
    discardPendingChunks();
    setBusy(true);
    setError("");
    try {
      const loaded = await desktop.listMessages(id);
      if (generation.current === request) {
        setSelected(id);
        setMessages(loaded);
        setDraftValue(draftsBySession.current.get(id) ?? "", id);
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
    setHome(false);
    if (sending || busy) return;
    rememberCurrentDraft();
    const request = ++generation.current;
    discardPendingChunks();
    setBusy(true);
    setError("");
    try {
      const item = await desktop.createSession();
      if (request !== generation.current) return;
      setSessions((current) => [item, ...current]);
      setNotes(false);
      setMemoryView(false);
      setConversationControls(false);
      setNoteStatus("");
      setSelected(item.id);
      setMessages([]);
      setDraftValue(draftsBySession.current.get(item.id) ?? "", item.id);
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
  function openConversationControls() {
    if (!session || sending || busy) return;
    setConversationControls(true);
  }
  async function updateConversationSession(
    target: Session,
    title: string,
    memoryEnabled: boolean,
    notesEnabled: boolean,
  ): Promise<Session | null> {
    const request = generation.current;
    setBusy(true);
    setError("");
    try {
      const updated = sample
        ? {
            ...target,
            title,
            memoryEnabled,
            notesEnabled,
            revision: target.revision + 1,
          }
        : await desktop.updateSession(
            target.id,
            title,
            memoryEnabled,
            notesEnabled,
            target.revision,
          );
      if (request !== generation.current) return null;
      setSessions((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNoteStatus("");
      setAnnouncement("Conversation controls saved.");
      return updated;
    } catch (reason) {
      if (request === generation.current) {
        if (!sample) {
          try {
            const latest = await desktop.listSessions();
            if (request === generation.current) {
              setSessions(latest);
              if (!latest.some((item) => item.id === target.id)) {
                setConversationControls(false);
                setError("This conversation is no longer available.");
              }
            }
          } catch {
            /* Keep the entered draft and the original revision for retry. */
          }
        }
      }
      throw reason;
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  function clearRendererForLock() {
    resetSamplePlans();
    generation.current++;
    turnGeneration.current++;
    discardPendingChunks();
    activeTurn.current = false;
    stopRequested.current = false;
    setMessages([]);
    setUserNotes([]);
    setMemories([]);
    setMemoryError("");
    setMemoryLoading(false);
    setSearch("");
    setNoteStatus("");
    setHighlight(null);
    setSessions([]);
    setSelected(null);
    draftsBySession.current.clear();
    setDraftValue("", null);
    setPassphrase("");
    setConfirmation("");
    setError("");
    setProvider("ollama");
    setRemoteConsent(false);
    setConnected(false);
    setModel("");
    setAnnouncement("Vault locked.");
    setSettings(false);
    setRestoreOpen(false);
    setPlansOpen(false);
    setDuePlan(null);
    setConversationControls(false);
    setNotes(false);
    setMemoryView(false);
    setDeleteConversation(false);
    setDrawer(false);
    setSending(false);
    setStopping(false);
    setNewReply(false);
    setBusy(false);
    setScreen("locked");
  }
  async function newPrivateSession() {
    setHome(false);
    if (sending || busy || sample) return;
    rememberCurrentDraft();
    const request = ++generation.current;
    discardPendingChunks();
    setBusy(true);
    setError("");
    try {
      const item = await desktop.createPrivateSession();
      if (request !== generation.current) return;
      setSessions((current) => [item, ...current]);
      setSelected(item.id);
      setMessages([]);
      setDraftValue("", item.id);
      setNotes(false);
      setMemoryView(false);
      setDrawer(false);
      setAnnouncement(
        "Private conversation opened. It disappears when the vault locks.",
      );
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
    setBusy(true);
    setError("");
    try {
      if (activeTurn.current) await desktop.cancelTurn().catch(() => {});
      await desktop.lockVault();
      clearRendererForLock();
    } catch {
      setError("The vault could not be locked. Try locking it again.");
    } finally {
      locking.current = false;
      if (screen === "conversation") setBusy(false);
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
      draftsBySession.current.delete(id);
      setSelected(null);
      setMessages([]);
      setDraftValue("", null);
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
    rememberCurrentDraft();
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
        setDraftValue(
          draftsBySession.current.get(memory.sessionId) ?? "",
          memory.sessionId,
        );
      } finally {
        if (request === generation.current) setBusy(false);
      }
    }
    if (request === generation.current) {
      setNotes(false);
      setMemoryView(false);
      setNoteStatus("");
      setHighlight(memory.sourceMessageId);
    }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (
      !draft.trim() ||
      activeTurn.current ||
      busy ||
      sample ||
      dictation.phase === "listening" ||
      dictation.phase === "finishing"
    )
      return;
    if (!connected || !model || (provider !== "ollama" && !remoteConsent)) {
      setSettings(true);
      return;
    }
    const turnMemoryEnabled = sessionMemoryEnabled;
    const turnNotesEnabled = sessionNotesEnabled;
    activeTurn.current = true;
    stopRequested.current = false;
    discardPendingChunks();
    setSending(true);
    setStopping(false);
    setError("");
    setAnnouncement("Preparing a reply");
    setNoteStatus("");
    const content = draft.trim();
    const request = generation.current;
    const turn = ++turnGeneration.current;
    let received = false;
    let cancellationSent = false;
    setDraftValue("", selected);
    const restoreDraft = () =>
      setDraft((current) => {
        const restored = current ? `${content}\n\n${current}` : content;
        if (selected) draftsBySession.current.set(selected, restored);
        return restored;
      });
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
          if (generation.current !== request || turnGeneration.current !== turn)
            return;
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
            queueChunk(event.messageId, event.content, request, turn);
          if (event.type === "finished") {
            flushPendingChunks(request, turn);
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
            activeTurn.current = false;
            setSending(false);
            setStopping(false);
          }
          if (event.type === "notes") {
            if (event.status === "updating" && stopRequested.current) {
              void desktop.cancelTurn().catch((reason) => {
                if (generation.current === request) setError(errorText(reason));
              });
            }
            const status = formatDerivationStatus(
              event.status,
              event.memoryEnabled ?? turnMemoryEnabled,
              event.notesEnabled ?? turnNotesEnabled,
              event.message,
            );
            setNoteStatus(status);
            if (status) setAnnouncement(status);
          }
          if (event.type === "error") {
            flushPendingChunks(request, turn);
            setError(event.message);
            setAnnouncement("The reply could not be completed.");
          }
        },
      });
    } catch (reason) {
      if (generation.current === request && turnGeneration.current === turn) {
        setError(errorText(reason));
        if (!received) restoreDraft();
      }
    } finally {
      if (generation.current === request && turnGeneration.current === turn) {
        try {
          const [updatedSessions, updatedNotes, updatedMemories] =
            await Promise.all([
              desktop.listSessions(),
              desktop.listNotes(),
              desktop.listMemories(),
            ]);
          if (
            generation.current === request &&
            turnGeneration.current === turn
          ) {
            setSessions(updatedSessions);
            setUserNotes(updatedNotes);
            setMemories(updatedMemories);
          }
        } catch {
          if (generation.current === request && turnGeneration.current === turn)
            setError(
              (current) =>
                current || "Conversation history could not be refreshed.",
            );
        }
      }
      if (generation.current === request && turnGeneration.current === turn) {
        flushPendingChunks(request, turn);
        activeTurn.current = false;
        setSending(false);
        setStopping(false);
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
    if (
      !reply ||
      activeTurn.current ||
      busy ||
      sample ||
      (!sessionMemoryEnabled && !sessionNotesEnabled)
    )
      return;
    const retryMemoryEnabled = sessionMemoryEnabled;
    const retryNotesEnabled = sessionNotesEnabled;
    if (!connected || !model || (provider !== "ollama" && !remoteConsent)) {
      setSettings(true);
      return;
    }
    const request = generation.current;
    activeTurn.current = true;
    stopRequested.current = false;
    setSending(true);
    setNoteStatus(
      formatDerivationStatus("updating", retryMemoryEnabled, retryNotesEnabled),
    );
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
            const status = formatDerivationStatus(
              event.status,
              event.memoryEnabled ?? retryMemoryEnabled,
              event.notesEnabled ?? retryNotesEnabled,
              event.message,
            );
            setNoteStatus(status);
            if (status) setAnnouncement(status);
            if (stopRequested.current)
              void desktop.cancelTurn().catch(() => {});
          }
          if (event.type === "error") setError(event.message);
        },
      });
      const [updatedNotes, updatedMemories] = await Promise.all([
        desktop.listNotes(),
        desktop.listMemories(),
      ]);
      if (request === generation.current) {
        setUserNotes(updatedNotes);
        setMemories(updatedMemories);
      }
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
    if (stopRequested.current) return;
    stopRequested.current = true;
    setStopping(true);
    const request = generation.current;
    const turn = turnGeneration.current;
    try {
      await desktop.cancelTurn();
    } catch (reason) {
      if (request === generation.current && turn === turnGeneration.current) {
        stopRequested.current = false;
        setStopping(false);
        setError(errorText(reason));
      }
    }
  }

  const rail = (
    <>
      <div className="rail-brand">
        <Mark />
        <span>Openmind</span>
      </div>
      <div className="rail-topline">Personal workspace</div>
      <button
        className="new-conversation"
        onClick={
          sample
            ? () => {
                setHome(false);
                setNotes(false);
                setMemoryView(false);
                setSettings(true);
              }
            : newSession
        }
        disabled={sending || busy}
      >
        <Plus size={18} />
        New conversation
      </button>
      {!sample && (
        <button
          className="private-conversation"
          onClick={() => void newPrivateSession()}
          disabled={sending || busy}
        >
          <Ghost size={17} />
          Private conversation
        </button>
      )}
      <div className="workspace-navigation">
        <button
          className={`rail-action ${home ? "rail-action-selected" : ""}`}
          onClick={() => {
            setHome(true);
            setNotes(false);
            setMemoryView(false);
            setDrawer(false);
          }}
          aria-current={home ? "page" : undefined}
        >
          <House size={17} />
          Overview
        </button>
        <button
          className="rail-action"
          onClick={() => {
            setPlansOpen(true);
            setDrawer(false);
          }}
        >
          <CalendarDays size={17} />
          Planned sessions
        </button>
      </div>
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
                className={`session-item ${selected === item.id && !notes && !memoryView && !home ? "selected" : ""}`}
                aria-current={
                  selected === item.id && !notes && !memoryView && !home
                    ? "page"
                    : undefined
                }
                disabled={sending || busy}
              >
                <span>
                  {item.private ? `Private · ${item.title}` : item.title}
                </span>
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
            setHome(false);
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
            setHome(false);
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
            Leave workspace
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
          {sample ? "Browser workspace" : "Encrypted on this device"}
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
          <aside className="desktop-rail" aria-label="Workspace navigation">
            {rail}
          </aside>
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
                  {home
                    ? "Overview"
                    : memoryView
                      ? "Remembered context"
                      : notes
                        ? "Your notes"
                        : "Conversation"}
                </span>
                <span className="header-slash" aria-hidden="true">
                  /
                </span>
                <span className="header-date">
                  {memoryView
                    ? `${memories.length} ${memories.length === 1 ? "item" : "items"}`
                    : home
                      ? new Date().toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                        })
                      : session
                        ? dateLabel(session.createdAt)
                        : "A fresh page"}
                </span>
              </div>
              <div className="header-actions">
                <button
                  className="workspace-status"
                  onClick={() => setSettings(true)}
                >
                  <span className="status-dot" />
                  {sample
                    ? "Browser"
                    : connected
                      ? model || "Connected"
                      : "Connect a model"}
                </button>
                {!home && !notes && !memoryView && session && (
                  <button
                    className="icon-button"
                    aria-label="Conversation controls"
                    onClick={openConversationControls}
                    disabled={sending || busy}
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                )}
                {!home && !notes && !memoryView && selected && !sample && (
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
            {!home &&
              !notes &&
              !memoryView &&
              session &&
              (session.private ||
                !sessionMemoryEnabled ||
                !sessionNotesEnabled) && (
                <div className="conversation-status" role="status">
                  <span>
                    {session.private
                      ? "Private conversation. It is never saved and disappears when the vault locks."
                      : !sessionMemoryEnabled && !sessionNotesEnabled
                        ? "Remembered context and Your notes are off for this conversation."
                        : !sessionMemoryEnabled
                          ? "Remembered context is off for this conversation."
                          : "Your notes are off for this conversation."}
                  </span>
                  {!session.private && (
                    <button
                      className="text-button"
                      onClick={openConversationControls}
                      disabled={sending || busy}
                    >
                      Review controls
                    </button>
                  )}
                </div>
              )}
            {home ? (
              <HomeWorkspace
                plansRevision={plansRevision}
                sessions={sessions}
                notes={userNotes}
                memories={memories}
                disabled={busy || sending}
                sample={sample}
                onNew={
                  sample
                    ? () => {
                        setHome(false);
                        setSettings(true);
                      }
                    : newSession
                }
                onSession={(id) => void selectSession(id)}
                onNotes={() => {
                  setHome(false);
                  setNotes(true);
                  setMemoryView(false);
                }}
                onMemory={() => {
                  setHome(false);
                  setMemoryView(true);
                  setNotes(false);
                }}
                onPlans={() => setPlansOpen(true)}
              />
            ) : memoryView ? (
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
                  rememberCurrentDraft();
                  atBottom.current = false;
                  setNewReply(false);
                  if (note.sessionId !== selected) {
                    setBusy(true);
                    try {
                      const loaded = await desktop.listMessages(note.sessionId);
                      if (request !== generation.current) return;
                      setSelected(note.sessionId);
                      setMessages(loaded);
                      setDraftValue(
                        draftsBySession.current.get(note.sessionId) ?? "",
                        note.sessionId,
                      );
                    } finally {
                      if (request === generation.current) setBusy(false);
                    }
                  }
                  if (request === generation.current) {
                    setNotes(false);
                    setMemoryView(false);
                    setNoteStatus("");
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
                          Leave workspace <ArrowRight size={16} />
                        </button>
                      </div>
                    ) : (
                      <ChatComposer
                        value={draft}
                        onValueChange={setDraftValue}
                        onSubmit={send}
                        onStop={stop}
                        textareaRef={composer}
                        disabled={busy}
                        enterToSend={enterToSend}
                        sending={sending}
                        stopping={stopping}
                        hasReplyContent={hasReplyContent}
                        noteStatus={noteStatus}
                        connectionReady={
                          connected && (provider === "ollama" || remoteConsent)
                        }
                        leadingControls={
                          <DictationControl
                            phase={dictation.phase}
                            message={dictation.message}
                            disabled={busy || sending}
                            onInstall={() => void dictation.install()}
                            onStart={() => void dictation.start()}
                            onFinish={dictation.finish}
                            onCancel={dictation.cancel}
                          />
                        }
                        voiceState={
                          dictation.phase === "listening"
                            ? "listening"
                            : dictation.phase === "finishing"
                              ? "processing"
                              : "idle"
                        }
                        voiceTheme={
                          appearance === "dark"
                            ? "dark"
                            : appearance === "light"
                              ? "light"
                              : "auto"
                        }
                      />
                    )}
                    <div className="notes-update-row">
                      {noteStatus && (
                        <p className="note-status">{noteStatus}</p>
                      )}
                      {!sample &&
                        (sessionMemoryEnabled || sessionNotesEnabled) &&
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
                            {sessionMemoryEnabled && !sessionNotesEnabled
                              ? "Update remembered context"
                              : "Update notes"}
                          </button>
                        )}
                    </div>
                    <div className="composer-footnote">
                      <span>
                        {sample ? (
                          "Changes in this browser tab are not saved"
                        ) : connected ? (
                          <>
                            <span className="status-dot" />{" "}
                            {provider === "ollama"
                              ? "Ollama on loopback"
                              : provider === "codex"
                                ? "Online · ChatGPT via Codex"
                                : "Online · OpenAI-compatible API"}
                          </>
                        ) : (
                          <button onClick={() => setSettings(true)}>
                            {provider === "ollama"
                              ? "Connect a local model"
                              : "Set up online connection"}{" "}
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
          onRestore={isDesktop ? () => setRestoreOpen(true) : undefined}
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
      {duePlan && (
        <Dialog
          title="A planned session is ready"
          onClose={() => setDuePlan(null)}
        >
          <p>{duePlan}</p>
          <p className="field-hint">
            Open a conversation whenever you are ready.
          </p>
          <div className="note-actions">
            <button
              className="secondary-button"
              onClick={() => setDuePlan(null)}
            >
              Later
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setDuePlan(null);
                void newSession();
              }}
            >
              Start conversation
            </button>
          </div>
        </Dialog>
      )}
      {conversationControls && session && (
        <ConversationControls
          key={session.id}
          session={session}
          sample={sample}
          disabled={sending || busy}
          onClose={() => setConversationControls(false)}
          onSave={updateConversationSession}
        />
      )}
      {settings && (
        <Dialog
          title="Settings"
          className="settings-dialog"
          onClose={() => setSettings(false)}
        >
          <div className="settings-layout">
            <nav className="settings-navigation" aria-label="Settings sections">
              <button
                aria-current={
                  settingsPage === "appearance" ? "page" : undefined
                }
                onClick={() => setSettingsPage("appearance")}
              >
                <Palette size={16} />
                Appearance
              </button>
              <button
                aria-current={
                  settingsPage === "connection" ? "page" : undefined
                }
                onClick={() => setSettingsPage("connection")}
              >
                <Plug size={16} />
                Model connection
              </button>
              <button
                aria-current={settingsPage === "privacy" ? "page" : undefined}
                onClick={() => setSettingsPage("privacy")}
              >
                <Shield size={16} />
                Privacy & storage
              </button>
              <button
                aria-current={settingsPage === "memory" ? "page" : undefined}
                onClick={() => setSettingsPage("memory")}
              >
                <Brain size={16} />
                Memory & notes
              </button>
            </nav>
            <div className="settings-content">
              {settingsPage === "connection" && (
                <ProviderSettingsPanel
                  sample={sample}
                  onSaved={applyProviderSettings}
                />
              )}{" "}
              {settingsPage === "appearance" && (
                <div className="settings-section">
                  <AppearanceSettings
                    appearance={appearance}
                    onAppearance={setAppearance}
                    color={colorTheme}
                    onColor={setColorTheme}
                  />
                  <div className="eyebrow reading-heading">
                    READING & WRITING
                  </div>
                  <label htmlFor="text-size" className="setting-row">
                    Conversation text <span>{reading.textScalePercent}%</span>
                  </label>
                  <input
                    id="text-size"
                    type="range"
                    min={90}
                    max={130}
                    step={5}
                    value={reading.textScalePercent}
                    onChange={(event) =>
                      void saveReadingSettings({
                        ...reading,
                        textScalePercent: Number(event.target.value),
                      })
                    }
                  />
                  <label htmlFor="line-width">Reading width</label>
                  <select
                    id="line-width"
                    value={reading.lineWidth}
                    onChange={(event) =>
                      void saveReadingSettings({
                        ...reading,
                        lineWidth: event.target
                          .value as ReadingSettings["lineWidth"],
                      })
                    }
                  >
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                    <option value="wide">Wide</option>
                  </select>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={enterToSend}
                      onChange={(event) =>
                        void saveReadingSettings({
                          ...reading,
                          enterToSend: event.target.checked,
                        })
                      }
                    />
                    Enter sends a message
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={reading.reduceMotion}
                      onChange={(event) =>
                        void saveReadingSettings({
                          ...reading,
                          reduceMotion: event.target.checked,
                        })
                      }
                    />
                    Reduce interface motion
                  </label>
                  <p className="field-hint">
                    When off, use Ctrl / ⌘ + Enter to send.
                  </p>
                  {readingError && (
                    <p className="inline-error" role="alert">
                      {readingError}
                    </p>
                  )}
                </div>
              )}
              {settingsPage === "appearance" && (
                <p className="settings-footnote">
                  Appearance is saved on this device.
                </p>
              )}
              {settingsPage === "privacy" && (
                <PrivacySettings
                  sample={sample}
                  onDataChanged={loadSessions}
                  onReset={() => {
                    clearRendererForLock();
                    setScreen("setup");
                  }}
                />
              )}
              {settingsPage === "memory" && (
                <div className="settings-section">
                  <h3>Memory & notes</h3>
                  <p>
                    Remembered context helps conversations continue. You can
                    review its sources, correct a detail, or forget it.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSettings(false);
                      setHome(false);
                      setMemoryView(true);
                      setNotes(false);
                    }}
                  >
                    Review remembered context
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSettings(false);
                      setHome(false);
                      setNotes(true);
                      setMemoryView(false);
                    }}
                  >
                    Open your notes
                  </button>
                  <MemoryIndexSettings sample={sample} />
                </div>
              )}
            </div>
          </div>
          <div className="settings-footer">
            <button
              className="primary-button"
              onClick={() => setSettings(false)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
      {restoreOpen && (
        <Dialog title="Restore workspace" onClose={() => setRestoreOpen(false)}>
          <RestoreWorkspace
            onRestored={async () => {
              setRestoreOpen(false);
              await loadSessions();
            }}
          />
        </Dialog>
      )}
      {plansOpen && (
        <Dialog title="Planned sessions" onClose={() => setPlansOpen(false)}>
          <PlannedSessions
            sample={sample}
            onChanged={() => setPlansRevision((value) => value + 1)}
          />
        </Dialog>
      )}
    </div>
  );
}
