import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { desktop, type Session, type TurnEvent } from "./lib/desktop";

vi.mock("./lib/desktop", () => ({
  isDesktop: true,
  desktop: {
    getVaultStatus: vi.fn(),
    openDemo: vi.fn(),
    listNotes: vi.fn(),
    editNote: vi.fn(),
    deleteNote: vi.fn(),
    retryNotes: vi.fn(),
    createVault: vi.fn(),
    unlockVault: vi.fn(),
    lockVault: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listMessages: vi.fn(),
    listModels: vi.fn(),
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
