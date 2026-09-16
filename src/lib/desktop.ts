import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  memoryEnabled: boolean;
  notesEnabled: boolean;
  private?: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "interrupted";
  createdAt: string;
}

export type ProviderKind = "ollama" | "codex" | "openaiCompatible";

export interface ProviderSettings {
  provider: ProviderKind; baseUrl: string; model: string; remoteDataConsent: boolean; credentialPresent: boolean; revision: number;
}
export interface ReadingSettings {
  textScalePercent: number; lineWidth: "compact" | "comfortable" | "wide"; reduceMotion: boolean; enterToSend: boolean; revision: number;
}
export interface ProviderHealth {
  provider: ProviderKind; status: "ready" | "unavailable" | "authRequired" | "misconfigured"; destination: "local" | "remote"; model: string; capabilities: { streaming: boolean; structuredNotes: boolean }; message?: string;
}
export interface NoteJob {
  messageId: string; status: "pending" | "running" | "complete" | "failed"; attemptCount: number; nextAttemptAt?: string; lastErrorCode?: string; memoryEnabled: boolean; notesEnabled: boolean; provider: ProviderKind; model: string; createdAt: string; updatedAt: string;
}

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
      status: "updating" | "complete" | "failed" | "skipped";
      message?: string;
      memoryEnabled?: boolean;
      notesEnabled?: boolean;
    };

export const isDesktop = isTauri();

export interface SessionPlan {
  id: string;
  label: string;
  localStart: string;
  timezone: string;
  recurrence: "once" | "daily" | "weekly";
  notifications: boolean;
  enabled: boolean;
  nextAt: string;
  revision: number;
}
export type PlanInput = Pick<
  SessionPlan,
  "label" | "localStart" | "timezone" | "recurrence" | "notifications"
>;

export interface LifecycleSettings {
  idleLockMinutes: number | null;
  retentionDays: number | null;
}
export interface BackupSummary {
  createdAt: string;
  sessions: number;
  messages: number;
}
export interface RestoreResult {
  status: VaultStatus;
  summary: BackupSummary;
}

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
  getProviderSettings: () => native<ProviderSettings>("get_provider_settings"),
  updateProviderSettings: (settings: ProviderSettings, apiKey?: string, clearApiKey = false) => native<ProviderSettings>("update_provider_settings", { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, remoteDataConsent: settings.remoteDataConsent, expectedRevision: settings.revision, apiKey, clearApiKey }),
  checkProviderHealth: () => native<ProviderHealth>("check_provider_health"),
  getReadingSettings: () => native<ReadingSettings>("get_reading_settings"),
  updateReadingSettings: (settings: ReadingSettings) => native<ReadingSettings>("update_reading_settings", { ...settings, expectedRevision: settings.revision }),
  listNoteJobs: () => native<NoteJob[]>("list_note_jobs"),
  async resumeNoteJobs(onEvent: (event: TurnEvent) => void): Promise<void> {
    const channel = new Channel<TurnEvent>(); channel.onmessage = onEvent;
    try { await native<void>("resume_note_jobs", { onEvent: channel }); }
    finally { channel.onmessage = () => {}; }
  },
  getLifecycleSettings: () =>
    native<LifecycleSettings>("get_lifecycle_settings"),
  updateLifecycleSettings: (
    idleLockMinutes: number | null,
    retentionDays: number | null,
  ) =>
    native<LifecycleSettings>("update_lifecycle_settings", {
      idleLockMinutes,
      retentionDays,
    }),
  exportBackup: (path: string, backupPassphrase: string) =>
    native<BackupSummary>("export_vault_backup", { path, backupPassphrase }),
  restoreBackup: (
    path: string,
    backupPassphrase: string,
    confirmation: string,
  ) =>
    native<RestoreResult>("restore_vault_backup", {
      path,
      backupPassphrase,
      confirmation,
    }),
  changePassphrase: (currentPassphrase: string, newPassphrase: string) =>
    native<void>("change_vault_passphrase", {
      currentPassphrase,
      newPassphrase,
    }),
  pruneRetention: (confirmation: string) =>
    native<{ sessionsDeleted: number }>("prune_retention", { confirmation }),
  resetVault: (confirmation: string) =>
    native<VaultStatus>("reset_vault", { confirmation }),
  createPrivateSession: () => native<Session>("create_private_session"),
  recordActivity: () => native<void>("record_activity"),
  listPlans: () => native<SessionPlan[]>("list_plans"),
  createPlan: (input: PlanInput) =>
    native<SessionPlan>("create_plan", { input }),
  removePlan: (id: string, expectedRevision: number) =>
    native<void>("remove_plan", { id, expectedRevision }),
  enablePlan: (id: string, enabled: boolean, expectedRevision: number) =>
    native<SessionPlan>("enable_plan", { id, enabled, expectedRevision }),
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
  updateSession: (
    id: string,
    title: string,
    memoryEnabled: boolean,
    notesEnabled: boolean,
    expectedRevision: number,
  ) =>
    native<Session>("update_session", {
      id,
      title,
      memoryEnabled,
      notesEnabled,
      expectedRevision,
    }),
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
