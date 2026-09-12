import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "interrupted";
  createdAt: string;
}

export type ProviderKind = "ollama" | "codex";

export interface ModelInfo {
  name: string;
  size: number;
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  isDemo: boolean;
}

export interface UserNote {
  id: string;
  sessionId: string;
  sourceMessageId: string;
  kind: "takeaway" | "question" | "next_step";
  content: string;
  evidenceQuote: string;
  revision: number;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A concise, source-backed record from Openmind's internal remembered context. */
export type MemoryKind = "person" | "event" | "goal" | "preference" | "concern";

export type MemoryEvidenceState =
  "user_reported" | "user_confirmed" | "inferred";

export interface MemoryRecord {
  id: string;
  sessionId: string;
  sourceMessageId: string;
  assistantMessageId: string;
  kind: MemoryKind;
  content: string;
  evidenceQuote: string;
  evidenceState: MemoryEvidenceState;
  revision: number;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TurnEvent =
  | { type: "message"; message: Message }
  | { type: "chunk"; messageId: string; content: string }
  | { type: "finished"; messageId: string; status: "complete" | "interrupted" }
  | { type: "error"; message: string }
  | {
      type: "notes";
      messageId: string;
      status: "updating" | "complete" | "failed";
      message?: string;
    };

export const isDesktop = isTauri();

function native<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktop) {
    return Promise.reject(
      new Error(
        "Open the desktop app to use an encrypted vault and connect a model.",
      ),
    );
  }
  return invoke<T>(command, args).catch((error: unknown) => {
    throw new Error(
      typeof error === "string"
        ? error
        : "The desktop operation could not be completed.",
    );
  });
}

export const desktop = {
  getVaultStatus: () => native<VaultStatus>("get_vault_status"),
  openDemo: (loginId: string, passphrase: string) =>
    native<VaultStatus>("open_demo", { loginId, passphrase }),
  listNotes: () => native<UserNote[]>("list_notes"),
  listMemories: () => native<MemoryRecord[]>("list_memories"),
  editNote: (id: string, content: string, expectedRevision: number) =>
    native<UserNote>("edit_note", { id, content, expectedRevision }),
  deleteNote: (id: string, expectedRevision: number) =>
    native<void>("delete_note", { id, expectedRevision }),
  editMemory: (id: string, content: string, expectedRevision: number) =>
    native<MemoryRecord>("edit_memory", { id, content, expectedRevision }),
  deleteMemory: (id: string, expectedRevision: number) =>
    native<void>("delete_memory", { id, expectedRevision }),
  async retryNotes({
    messageId,
    baseUrl,
    model,
    provider,
    remoteConsent,
    onEvent,
  }: {
    messageId: string;
    baseUrl: string;
    model: string;
    provider: ProviderKind;
    remoteConsent: boolean;
    onEvent: (event: TurnEvent) => void;
  }): Promise<void> {
    const channel = new Channel<TurnEvent>();
    channel.onmessage = onEvent;
    try {
      await native<void>("retry_notes", {
        messageId,
        baseUrl,
        model,
        provider,
        remoteConsent,
        onEvent: channel,
      });
    } finally {
      channel.onmessage = () => {};
    }
  },
  createVault: (passphrase: string) =>
    native<void>("create_vault", { passphrase }),
  unlockVault: (passphrase: string) =>
    native<void>("unlock_vault", { passphrase }),
  lockVault: () => native<void>("lock_vault"),
  listSessions: () => native<Session[]>("list_sessions"),
  createSession: () => native<Session>("create_session"),
  deleteSession: (id: string) => native<void>("delete_session", { id }),
  listMessages: (sessionId: string) =>
    native<Message[]>("list_messages", { sessionId }),
  listModels: (baseUrl: string) =>
    native<ModelInfo[]>("list_models", { baseUrl }),
  listCodexModels: () => native<ModelInfo[]>("list_codex_models"),
  cancelTurn: () => native<void>("cancel_turn"),
  async sendMessage({
    sessionId,
    content,
    baseUrl,
    model,
    provider,
    remoteConsent,
    onEvent,
  }: {
    sessionId: string;
    content: string;
    baseUrl: string;
    model: string;
    provider: ProviderKind;
    remoteConsent: boolean;
    onEvent: (event: TurnEvent) => void;
  }): Promise<void> {
    const channel = new Channel<TurnEvent>();
    channel.onmessage = onEvent;
    try {
      await native<void>("send_message", {
        sessionId,
        content,
        baseUrl,
        model,
        provider,
        remoteConsent,
        onEvent: channel,
      });
    } finally {
      channel.onmessage = () => {};
    }
  },
};
