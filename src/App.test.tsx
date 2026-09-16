import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  desktop,
  type MemoryRecord,
  type Session,
  type TurnEvent,
} from "./lib/desktop";

vi.mock("./lib/desktop", () => ({
  isDesktop: true,
  desktop: {
    onVaultLocked: vi.fn(),
    onPlannedSessionDue: vi.fn(),
    recordActivity: vi.fn(),
    getProviderSettings: vi.fn(),
    updateProviderSettings: vi.fn(),
    checkProviderHealth: vi.fn(),
    getReadingSettings: vi.fn(),
    updateReadingSettings: vi.fn(),
    listNoteJobs: vi.fn(),
    resumeNoteJobs: vi.fn(),
    createPrivateSession: vi.fn(),
    listPlans: vi.fn(),
    createPlan: vi.fn(),
    removePlan: vi.fn(),
    enablePlan: vi.fn(),
    getVaultStatus: vi.fn(),
    openDemo: vi.fn(),
    listNotes: vi.fn(),
    listMemories: vi.fn(),
    editNote: vi.fn(),
    deleteNote: vi.fn(),
    editMemory: vi.fn(),
    deleteMemory: vi.fn(),
    retryNotes: vi.fn(),
    createVault: vi.fn(),
    unlockVault: vi.fn(),
    lockVault: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    listMessages: vi.fn(),
    listModels: vi.fn(),
    listCodexModels: vi.fn(),
    sendMessage: vi.fn(),
    cancelTurn: vi.fn(),
  },
}));

const session: Session = {
  id: "synthetic-session",
  title: "Monday conversation",
  createdAt: "2026-09-07T09:00:00Z",
  updatedAt: "2026-09-07T09:00:00Z",
  revision: 3,
  memoryEnabled: true,
  notesEnabled: true,
};
const secondSession: Session = {
  id: "synthetic-session-two",
  title: "Tuesday conversation",
  createdAt: "2026-09-08T09:00:00Z",
  updatedAt: "2026-09-08T09:00:00Z",
  revision: 8,
  memoryEnabled: true,
  notesEnabled: true,
};
const memory: MemoryRecord = {
  id: "synthetic-memory",
  sessionId: session.id,
  sourceMessageId: "synthetic-source",
  assistantMessageId: "synthetic-assistant",
  kind: "goal",
  content: "A synthetic remembered goal.",
  evidenceQuote: "I want to make a little more room for rest.",
  evidenceState: "user_reported",
  revision: 3,
  edited: false,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
};
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function openConnectedApp() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Model connection" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Find available models" }),
  );
  await screen.findByDisplayValue("synthetic-model");
  fireEvent.click(
    screen.getByRole("button", { name: /Save and check connection/ }),
  );
  await screen.findByText("Connection saved. Ready for a conversation.");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  const conversation = screen.queryByRole("button", {
    name: /Monday conversation.*September/,
  });
  if (conversation) fireEvent.click(conversation);
}
function submit(content: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
    target: { value: content },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(desktop.getVaultStatus).mockResolvedValue({
    exists: true,
    unlocked: true,
    isDemo: false,
  });
  vi.mocked(desktop.onVaultLocked).mockResolvedValue(() => {});
  vi.mocked(desktop.onPlannedSessionDue).mockResolvedValue(() => {});
  vi.mocked(desktop.recordActivity).mockResolvedValue();
  vi.mocked(desktop.getProviderSettings).mockResolvedValue({
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "",
    remoteDataConsent: false,
    credentialPresent: false,
    revision: 1,
  });
  vi.mocked(desktop.updateProviderSettings).mockImplementation(
    async (value) => ({
      ...value,
      revision: value.revision + 1,
    }),
  );
  vi.mocked(desktop.checkProviderHealth).mockResolvedValue({
    provider: "ollama",
    status: "ready",
    destination: "local",
    model: "synthetic-model",
    capabilities: { streaming: true, structuredNotes: true },
  });
  vi.mocked(desktop.getReadingSettings).mockResolvedValue({
    textScalePercent: 100,
    lineWidth: "comfortable",
    reduceMotion: false,
    enterToSend: true,
    revision: 1,
  });
  vi.mocked(desktop.updateReadingSettings).mockImplementation(
    async (value) => ({
      ...value,
      revision: value.revision + 1,
    }),
  );
  vi.mocked(desktop.resumeNoteJobs).mockResolvedValue();
  vi.mocked(desktop.listNoteJobs).mockResolvedValue([]);
  vi.mocked(desktop.listPlans).mockResolvedValue([]);
  vi.mocked(desktop.listNotes).mockResolvedValue([]);
  vi.mocked(desktop.listMemories).mockResolvedValue([]);
  vi.mocked(desktop.editMemory).mockResolvedValue({
    id: "synthetic-memory",
    sessionId: session.id,
    sourceMessageId: "synthetic-source",
    assistantMessageId: "synthetic-assistant",
    kind: "goal",
    content: "A synthetic remembered goal.",
    evidenceQuote: "A synthetic source quote.",
    evidenceState: "user_confirmed",
    revision: 2,
    edited: true,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
  vi.mocked(desktop.deleteMemory).mockResolvedValue();
  vi.mocked(desktop.listSessions).mockResolvedValue([session]);
  vi.mocked(desktop.listMessages).mockResolvedValue([]);
  vi.mocked(desktop.createSession).mockResolvedValue(session);
  vi.mocked(desktop.updateSession).mockResolvedValue({
    ...session,
    revision: session.revision + 1,
  });
  vi.mocked(desktop.listModels).mockResolvedValue([
    { name: "synthetic-model", size: 100 },
  ]);
  vi.mocked(desktop.cancelTurn).mockResolvedValue();
  vi.mocked(desktop.lockVault).mockResolvedValue();
  vi.mocked(desktop.unlockVault).mockResolvedValue();
});

describe("native conversation lifecycle", () => {
  it("ignores late text and old turn completion after lock and a new unlocked turn", async () => {
    const oldTurn = deferred<void>();
    const newTurn = deferred<void>();
    let emit: ((event: TurnEvent) => void) | undefined;
    vi.mocked(desktop.sendMessage)
      .mockImplementationOnce(({ onEvent }) => {
        emit = onEvent;
        return oldTurn.promise;
      })
      .mockImplementationOnce(() => newTurn.promise);
    await openConnectedApp();
    submit("A synthetic thought before locking.");
    act(() =>
      emit?.({
        type: "message",
        message: {
          id: "old-reply",
          sessionId: session.id,
          role: "assistant",
          content: "Visible before locking.",
          status: "streaming",
          createdAt: session.createdAt,
        },
      }),
    );
    expect(screen.getByText("Visible before locking.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));
    await screen.findByRole("button", { name: "Unlock your vault" });
    expect(desktop.cancelTurn).toHaveBeenCalledOnce();
    act(() =>
      emit?.({
        type: "chunk",
        messageId: "old-reply",
        content: "Late private text.",
      }),
    );
    expect(
      screen.queryByText(/Visible before locking|Late private text/),
    ).not.toBeInTheDocument();
    vi.mocked(desktop.getProviderSettings).mockResolvedValue({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "synthetic-model",
      remoteDataConsent: false,
      credentialPresent: false,
      revision: 2,
    });
    fireEvent.change(screen.getByLabelText("Your passphrase"), {
      target: { value: "synthetic-passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock your vault" }));
    await screen.findByRole("textbox", { name: "Your message" });
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "A new turn after unlocking." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(desktop.sendMessage).toHaveBeenCalledTimes(2);
    await act(async () => {
      oldTurn.resolve();
      await oldTurn.promise;
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "Typed ahead." },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your message" }), {
      key: "Enter",
    });
    expect(desktop.sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Late private text/)).not.toBeInTheDocument();
    await act(async () => {
      newTurn.resolve();
      await newTurn.promise;
    });
  });

  it("frees the composer when the reply finishes while notes continue", async () => {
    const turn = deferred<void>();
    let emit: ((event: TurnEvent) => void) | undefined;
    vi.mocked(desktop.sendMessage).mockImplementation(({ onEvent }) => {
      emit = onEvent;
      return turn.promise;
    });
    await openConnectedApp();
    submit("A synthetic thought.");
    act(() =>
      emit?.({ type: "finished", messageId: "reply", status: "complete" }),
    );
    expect(screen.queryByRole("button", { name: "Stop reply" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Your message" })).toBeEnabled();
    act(() =>
      emit?.({ type: "notes", messageId: "reply", status: "updating" }),
    );
    expect(screen.getByRole("textbox", { name: "Your message" })).toBeEnabled();
    await act(async () => {
      turn.resolve();
      await turn.promise;
    });
  });

  it("retries cancellation when the native turn becomes available after Stop", async () => {
    const turn = deferred<void>();
    let emit: ((event: TurnEvent) => void) | undefined;
    vi.mocked(desktop.sendMessage).mockImplementation(({ onEvent }) => {
      emit = onEvent;
      return turn.promise;
    });
    await openConnectedApp();
    submit("A synthetic thought.");
    fireEvent.click(screen.getByRole("button", { name: "Stop reply" }));
    await waitFor(() => expect(desktop.cancelTurn).toHaveBeenCalledOnce());
    act(() =>
      emit?.({
        type: "message",
        message: {
          id: "user-message",
          sessionId: session.id,
          role: "user",
          content: "A synthetic thought.",
          status: "complete",
          createdAt: session.createdAt,
        },
      }),
    );
    expect(desktop.cancelTurn).toHaveBeenCalledTimes(2);
    await act(async () => {
      turn.resolve();
      await turn.promise;
    });
  });

  it("preserves the failed message and text entered while the send was pending", async () => {
    const turn = deferred<void>();
    vi.mocked(desktop.sendMessage).mockReturnValue(turn.promise);
    await openConnectedApp();
    submit("First synthetic thought.");
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "Another thought typed ahead." },
    });
    await act(async () => {
      turn.reject(new Error("Connection unavailable."));
      await turn.promise.catch(() => {});
    });
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
      "First synthetic thought.\n\nAnother thought typed ahead.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connection unavailable.",
    );
  });
});

describe("conversation controls", () => {
  it("saves an edited title and independent settings with the current revision", async () => {
    const updated = {
      ...session,
      title: "A quieter Monday",
      memoryEnabled: false,
      notesEnabled: true,
      revision: 4,
    };
    vi.mocked(desktop.updateSession).mockResolvedValue(updated);
    await openConnectedApp();

    fireEvent.click(
      screen.getByRole("button", { name: "Conversation controls" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation title" }),
      {
        target: { value: updated.title },
      },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(desktop.updateSession).toHaveBeenCalledWith(
        session.id,
        updated.title,
        false,
        true,
        session.revision,
      ),
    );
    expect(
      await screen.findByRole("button", { name: /A quieter Monday/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Remembered context is off for this conversation."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps entered controls on save failure and retries with a refreshed revision", async () => {
    const refreshed = { ...session, revision: 9 };
    const saved = {
      ...refreshed,
      title: "Retry this conversation",
      memoryEnabled: false,
      notesEnabled: true,
      revision: 10,
    };
    vi.mocked(desktop.listSessions)
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([refreshed]);
    vi.mocked(desktop.updateSession)
      .mockRejectedValueOnce(new Error("Synthetic revision conflict."))
      .mockResolvedValueOnce(saved);
    await openConnectedApp();

    fireEvent.click(
      screen.getByRole("button", { name: "Conversation controls" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation title" }),
      {
        target: { value: saved.title },
      },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await within(screen.getByRole("dialog")).findByRole("alert"),
    ).toHaveTextContent("Synthetic revision conflict.");
    expect(
      screen.getByRole("textbox", { name: "Conversation title" }),
    ).toHaveValue(saved.title);
    expect(
      screen.getByRole("checkbox", { name: "Remembered context" }),
    ).not.toBeChecked();
    await waitFor(() => expect(desktop.listSessions).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(desktop.updateSession).toHaveBeenNthCalledWith(
        2,
        session.id,
        saved.title,
        false,
        true,
        refreshed.revision,
      ),
    );
    expect(
      await screen.findByRole("button", { name: /Retry this conversation/ }),
    ).toBeInTheDocument();
  });

  it("keeps conversation drafts separate while switching sessions", async () => {
    vi.mocked(desktop.listSessions).mockResolvedValue([session, secondSession]);
    vi.mocked(desktop.listMessages).mockResolvedValue([]);
    vi.mocked(desktop.getProviderSettings).mockResolvedValue({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "synthetic-model",
      remoteDataConsent: false,
      credentialPresent: false,
      revision: 2,
    });
    render(<App />);
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: /Monday conversation/ })
      )[0]!,
    );
    const composer = await screen.findByRole("textbox", {
      name: "Your message",
    });
    fireEvent.change(composer, { target: { value: "Draft for Monday." } });

    fireEvent.click(
      screen.getByRole("button", { name: /Tuesday conversation/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
        "",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Monday conversation/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
        "Draft for Monday.",
      ),
    );
  });

  it("disables controls during an active reply", async () => {
    const turn = deferred<void>();
    vi.mocked(desktop.sendMessage).mockReturnValue(turn.promise);
    await openConnectedApp();
    submit("A synthetic active reply.");

    await screen.findByRole("button", { name: "Stop reply" });
    expect(
      screen.getByRole("button", { name: "Conversation controls" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Settings" })).toBeDisabled();

    await act(async () => {
      turn.resolve();
      await turn.promise;
    });
  });

  it("shows scoped off status only in the conversation and skips disabled updates", async () => {
    const disabledSession = {
      ...session,
      memoryEnabled: false,
      notesEnabled: false,
    };
    vi.mocked(desktop.listSessions).mockResolvedValue([disabledSession]);
    const turn = deferred<void>();
    let emit: ((event: TurnEvent) => void) | undefined;
    vi.mocked(desktop.sendMessage).mockImplementation(({ onEvent }) => {
      emit = onEvent;
      return turn.promise;
    });
    await openConnectedApp();

    expect(
      screen.getByText(
        "Remembered context and Your notes are off for this conversation.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remembered context" }));
    expect(
      screen.queryByText(
        "Remembered context and Your notes are off for this conversation.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Conversation controls" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Monday conversation/ }),
    );
    expect(
      screen.getByText(
        "Remembered context and Your notes are off for this conversation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Update notes" }),
    ).not.toBeInTheDocument();

    submit("A synthetic skipped update.");
    act(() =>
      emit?.({
        type: "notes",
        messageId: "synthetic-reply",
        status: "skipped",
        memoryEnabled: false,
        notesEnabled: false,
      }),
    );
    expect(screen.queryByText(/updated/)).not.toBeInTheDocument();
    await act(async () => {
      turn.resolve();
      await turn.promise;
    });
  });

  it("ignores a save result that arrives after the vault is locked", async () => {
    const save = deferred<Session>();
    vi.mocked(desktop.updateSession).mockReturnValue(save.promise);
    await openConnectedApp();
    fireEvent.click(
      screen.getByRole("button", { name: "Conversation controls" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation title" }),
      {
        target: { value: "Stale saved title" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(desktop.updateSession).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));
    await screen.findByRole("button", { name: "Unlock your vault" });
    await act(async () => {
      save.resolve({ ...session, title: "Stale saved title", revision: 4 });
      await save.promise;
    });
    expect(screen.queryByText("Stale saved title")).not.toBeInTheDocument();
  });
});

describe("demo and notebook", () => {
  it("opens a seeded demo without creating a personal vault", async () => {
    vi.mocked(desktop.getVaultStatus).mockResolvedValue({
      exists: false,
      unlocked: false,
      isDemo: false,
    });
    vi.mocked(desktop.openDemo).mockResolvedValue({
      exists: true,
      unlocked: true,
      isDemo: true,
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Explore with example conversations",
      }),
    );
    await screen.findByRole("heading", { name: "Good morning." });
    expect(desktop.openDemo).toHaveBeenCalledWith("demo", "openmind-demo-2026");
    expect(desktop.createVault).not.toHaveBeenCalled();
  });
  it("deletes a conversation only after confirmation and clears its notes", async () => {
    vi.mocked(desktop.deleteSession).mockResolvedValue();
    vi.mocked(desktop.listNotes).mockResolvedValue([
      {
        id: "delete-note",
        sessionId: session.id,
        sourceMessageId: "delete-source",
        kind: "takeaway",
        content: "A synthetic note to delete.",
        evidenceQuote: "Synthetic quote.",
        revision: 1,
        edited: false,
        createdAt: session.createdAt,
        updatedAt: session.createdAt,
      },
    ]);
    render(<App />);
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: /Monday conversation/ })
      )[0]!,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete conversation",
      }),
    );
    expect(desktop.deleteSession).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete conversation" }).at(-1)!,
    );
    await waitFor(() =>
      expect(desktop.deleteSession).toHaveBeenCalledWith(session.id),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Delete conversation?" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(session.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Your notes" }));
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });
  it("retries notes for a completed reply without resending it", async () => {
    vi.mocked(desktop.listMessages).mockResolvedValue([
      {
        id: "reply-1",
        sessionId: session.id,
        role: "assistant",
        content: "A completed fictional reply.",
        status: "complete",
        createdAt: session.createdAt,
      },
    ]);
    const updating = deferred<void>();
    vi.mocked(desktop.retryNotes).mockReturnValue(updating.promise);
    await openConnectedApp();
    fireEvent.click(screen.getByRole("button", { name: "Update notes" }));
    expect(desktop.retryNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "reply-1",
        model: "synthetic-model",
      }),
    );
    expect(screen.getByRole("button", { name: "Update notes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop reply" }));
    expect(desktop.cancelTurn).toHaveBeenCalledOnce();
    await act(async () => {
      updating.resolve();
      await updating.promise;
    });
    expect(desktop.sendMessage).not.toHaveBeenCalled();
  });
  it("saves a note using its revision and keeps its source evidence", async () => {
    const note = {
      id: "note-1",
      sessionId: session.id,
      sourceMessageId: "source-1",
      kind: "takeaway" as const,
      content: "A fictional takeaway.",
      evidenceQuote: "A fictional source quote.",
      revision: 3,
      edited: false,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
    };
    vi.mocked(desktop.listNotes).mockResolvedValue([note]);
    vi.mocked(desktop.editNote).mockResolvedValue({
      ...note,
      content: "My corrected takeaway.",
      revision: 4,
      edited: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Your notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit note" }), {
      target: { value: "My corrected takeaway." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByText("My corrected takeaway.");
    expect(desktop.editNote).toHaveBeenCalledWith(
      "note-1",
      "My corrected takeaway.",
      3,
    );
    expect(screen.getByText("A fictional source quote.")).toBeInTheDocument();
    expect(screen.getByText("Edited by you")).toBeInTheDocument();
  });
});

describe("remembered context workspace", () => {
  it("groups source-backed context and opens its source conversation", async () => {
    const person = {
      ...memory,
      id: "synthetic-person-memory",
      kind: "person" as const,
      content: "A synthetic friend is part of the user's support circle.",
      evidenceQuote: "My friend checks in on Sundays.",
    };
    vi.mocked(desktop.listMemories).mockResolvedValue([memory, person]);
    vi.mocked(desktop.listMessages).mockResolvedValue([
      {
        id: memory.sourceMessageId,
        sessionId: session.id,
        role: "user",
        content: "I want to make a little more room for rest.",
        status: "complete",
        createdAt: session.createdAt,
      },
    ]);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Remembered context" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(memory.evidenceQuote)),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: /Monday conversation/ })[1]!,
    );
    expect(
      await screen.findByText("I want to make a little more room for rest."),
    ).toBeInTheDocument();
  });

  it("corrects wording while keeping original evidence visible", async () => {
    vi.mocked(desktop.listMemories).mockResolvedValue([memory]);
    vi.mocked(desktop.editMemory).mockResolvedValue({
      ...memory,
      content: "A corrected synthetic goal.",
      evidenceState: "user_confirmed",
      revision: 4,
      edited: true,
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Correct wording/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Correct remembered context" }),
      { target: { value: "A corrected synthetic goal." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await screen.findByText("A corrected synthetic goal.");
    expect(desktop.editMemory).toHaveBeenCalledWith(
      memory.id,
      "A corrected synthetic goal.",
      memory.revision,
    );
    expect(screen.getByText(/Edited by you/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(memory.evidenceQuote)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/source quote stays as it was originally captured/),
    ).toBeInTheDocument();
  });

  it("shows source-turn deletion scope before forgetting linked context", async () => {
    const secondMemory = {
      ...memory,
      id: "synthetic-memory-2",
      kind: "concern" as const,
      content: "A second synthetic memory from the same turn.",
    };
    vi.mocked(desktop.listMemories)
      .mockResolvedValueOnce([memory, secondMemory])
      .mockResolvedValueOnce([]);
    vi.mocked(desktop.listNotes)
      .mockResolvedValueOnce([
        {
          id: "linked-note",
          sessionId: session.id,
          sourceMessageId: memory.sourceMessageId,
          kind: "takeaway",
          content: "A linked edited synthetic note.",
          evidenceQuote: memory.evidenceQuote,
          revision: 1,
          edited: true,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      ])
      .mockResolvedValueOnce([]);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
    expect(
      screen.getByRole("heading", {
        name: "Forget context from this message?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/removes 2 remembered items and 1 linked note/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A linked edited synthetic note."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /including every linked note listed below and any wording you edited/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Edited by you/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /original message and reply will not be used for future replies or notes/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Forget this context" }),
    );
    await waitFor(() =>
      expect(desktop.deleteMemory).toHaveBeenCalledWith(
        memory.id,
        memory.revision,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText(memory.content)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Nothing remembered yet")).toBeInTheDocument();
  });

  it("keeps the workspace usable when memory listing fails", async () => {
    vi.mocked(desktop.listMemories).mockRejectedValue(
      new Error("Synthetic memory service unavailable."),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic memory service unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Reload context" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Remembered context" }),
    ).toBeInTheDocument();
  });

  it("preserves remembered context when forgetting is rejected", async () => {
    vi.mocked(desktop.listMemories).mockResolvedValue([memory]);
    vi.mocked(desktop.deleteMemory).mockRejectedValue(
      new Error("Synthetic delete rejected."),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Forget this context" }),
    );
    await waitFor(() =>
      expect(desktop.deleteMemory).toHaveBeenCalledWith(
        memory.id,
        memory.revision,
      ),
    );
    expect(screen.getByText(memory.content)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic delete rejected.",
    );
  });

  it("does not resurrect forgotten context when the refresh fails", async () => {
    vi.mocked(desktop.listMemories)
      .mockResolvedValueOnce([memory])
      .mockRejectedValueOnce(new Error("Synthetic refresh failed."));
    vi.mocked(desktop.deleteMemory).mockResolvedValue();
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remembered context" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Forget this context" }),
    );
    await waitFor(() =>
      expect(desktop.deleteMemory).toHaveBeenCalledWith(
        memory.id,
        memory.revision,
      ),
    );
    expect(screen.queryByText(memory.content)).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic refresh failed.",
    );
  });
});

describe("ChatGPT demo consent", () => {
  async function chooseCodex() {
    vi.mocked(desktop.getVaultStatus).mockResolvedValue({
      exists: true,
      unlocked: true,
      isDemo: true,
    });
    vi.mocked(desktop.listCodexModels).mockResolvedValue([
      { name: "synthetic-codex-model", size: 0 },
    ]);
    vi.mocked(desktop.listMessages).mockResolvedValue([
      {
        id: "demo-reply",
        sessionId: session.id,
        role: "assistant",
        content: "A synthetic demo reply.",
        status: "complete",
        createdAt: session.createdAt,
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Online provider/ }));
  }
  it("requires explicit consent for messages and note updates", async () => {
    await chooseCodex();
    const consent = screen.getByRole("checkbox", {
      name: "I agree to send this data to this provider.",
    });
    expect(consent).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Find available models" }),
    );
    await screen.findByDisplayValue("synthetic-codex-model");
    expect(
      screen.getByRole("button", { name: /Save and check connection/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I agree to send this data to this provider.",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Save and check connection/ }),
    );
    await screen.findByText("Connection saved. Ready for a conversation.");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: /Monday conversation/ })[0]!,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "A synthetic remote thought." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(desktop.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "codex",
          remoteConsent: true,
          model: "synthetic-codex-model",
        }),
      ),
    );
  });
  it("drops stale model discovery and clears consent when switching providers", async () => {
    await chooseCodex();
    const discovery = deferred<{ name: string; size: number }[]>();
    vi.mocked(desktop.listCodexModels).mockReturnValue(discovery.promise);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I agree to send this data to this provider.",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Find available models" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /On this device/ }));
    await act(async () => {
      discovery.resolve([{ name: "stale-remote-model", size: 0 }]);
      await discovery.promise;
    });
    expect(
      screen.queryByRole("combobox", { name: "Model" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Online provider/ }));
    expect(
      screen.getByRole("checkbox", {
        name: "I agree to send this data to this provider.",
      }),
    ).not.toBeChecked();
  });
  it("keeps personal vaults on Ollama", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(
      screen.queryByRole("option", { name: "ChatGPT via Codex" }),
    ).not.toBeInTheDocument();
  });
});
