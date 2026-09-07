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

export interface ModelInfo {
  name: string;
  size: number;
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

export type TurnEvent =
  | { type: "message"; message: Message }
  | { type: "chunk"; messageId: string; content: string }
  | { type: "finished"; messageId: string; status: "complete" | "interrupted" }
  | { type: "error"; message: string };

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
  createVault: (passphrase: string) =>
    native<void>("create_vault", { passphrase }),
  unlockVault: (passphrase: string) =>
    native<void>("unlock_vault", { passphrase }),
  lockVault: () => native<void>("lock_vault"),
  listSessions: () => native<Session[]>("list_sessions"),
  createSession: () => native<Session>("create_session"),
  listMessages: (sessionId: string) =>
    native<Message[]>("list_messages", { sessionId }),
  listModels: (baseUrl: string) =>
    native<ModelInfo[]>("list_models", { baseUrl }),
  cancelTurn: () => native<void>("cancel_turn"),
  async sendMessage({
    sessionId,
    content,
    baseUrl,
    model,
    onEvent,
  }: {
    sessionId: string;
    content: string;
    baseUrl: string;
    model: string;
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
        onEvent: channel,
      });
    } finally {
      channel.onmessage = () => {};
    }
  },
};
