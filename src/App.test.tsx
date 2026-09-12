import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  await screen.findByText("Ollama is ready");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
    fireEvent.change(screen.getByLabelText("Your passphrase"), {
      target: { value: "synthetic-passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock your vault" }));
    await screen.findByRole("textbox", { name: "Your message" });
    expect(screen.queryByText("Ollama on loopback")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "A new turn after unlocking." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Set up model connection" }),
    );
    expect(desktop.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("combobox", { name: "Model" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    await screen.findByText("Ollama is ready");
    expect(desktop.listModels).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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

  it("stops before pending session creation can invoke inference and restores the draft", async () => {
    vi.mocked(desktop.listSessions).mockResolvedValue([]);
    const creation = deferred<Session>();
    vi.mocked(desktop.createSession).mockReturnValue(creation.promise);
    await openConnectedApp();
    submit("A synthetic unsent thought.");
    fireEvent.click(screen.getByRole("button", { name: "Stop reply" }));
    await act(async () => {
      creation.resolve(session);
      await creation.promise;
    });
    expect(desktop.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Your message" })).toHaveValue(
      "A synthetic unsent thought.",
    );
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Open demo" }));
    await screen.findByText("Demo workspace · Synthetic data only");
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
      await screen.findByRole("button", {
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
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
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
      screen.getByRole("button", { name: "Try again" }),
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
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "codex" },
    });
  }
  it("requires explicit consent for messages and note updates", async () => {
    await chooseCodex();
    const consent = screen.getByRole("checkbox", {
      name: "I agree to send this demo context to OpenAI.",
    });
    expect(consent).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    await screen.findByText("ChatGPT via Codex is ready");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your message" }), {
      target: { value: "A synthetic remote thought." },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your message" }), {
      key: "Enter",
    });
    expect(desktop.sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Update notes" }));
    expect(desktop.retryNotes).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I agree to send this demo context to OpenAI.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
        name: "I agree to send this demo context to OpenAI.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "ollama" },
    });
    await act(async () => {
      discovery.resolve([{ name: "stale-remote-model", size: 0 }]);
      await discovery.promise;
    });
    expect(
      screen.queryByRole("combobox", { name: "Model" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "codex" },
    });
    expect(
      screen.getByRole("checkbox", {
        name: "I agree to send this demo context to OpenAI.",
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
