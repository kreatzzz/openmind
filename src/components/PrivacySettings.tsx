import { useEffect, useState, type FormEvent } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, KeyRound, Trash2 } from "lucide-react";
import { desktop, type LifecycleSettings } from "../lib/desktop";

export function PrivacySettings({
  sample,
  onReset,
}: {
  sample: boolean;
  onReset: () => void;
}) {
  const [settings, setSettings] = useState<LifecycleSettings>({
    idleLockMinutes: 15,
    retentionDays: null,
  });
  const [operation, setOperation] = useState<
    "backup" | "passphrase" | "prune" | "reset" | null
  >(null);
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (sample) return;
    let ignore = false;
    desktop
      .getLifecycleSettings()
      .then((value) => {
        if (!ignore) setSettings(value);
      })
      .catch((reason) => {
        if (!ignore) setError(String(reason));
      });
    return () => {
      ignore = true;
    };
  }, [sample]);
  function choose(next: typeof operation) {
    setOperation(next);
    setPassword("");
    setCurrent("");
    setConfirmation("");
    setError("");
    setStatus("");
  }
  async function saveSettings(value: LifecycleSettings) {
    setBusy(true);
    setError("");
    try {
      setSettings(
        await desktop.updateLifecycleSettings(
          value.idleLockMinutes,
          value.retentionDays,
        ),
      );
      setStatus("Privacy settings saved.");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function execute(event: FormEvent) {
    event.preventDefault();
    if (busy || sample) return;
    setBusy(true);
    setError("");
    try {
      if (operation === "backup") {
        if (password !== confirmation)
          throw new Error("The backup passphrases do not match.");
        const path = await save({
          title: "Save encrypted backup",
          defaultPath: `openmind-${new Date().toISOString().slice(0, 10)}.openmind`,
          filters: [{ name: "Openmind backup", extensions: ["openmind"] }],
        });
        if (!path) return;
        const result = await desktop.exportBackup(path, password);
        setStatus(
          `Backup saved with ${result.sessions} conversations. Keep its passphrase separate from the file.`,
        );
      } else if (operation === "passphrase") {
        if (password !== confirmation)
          throw new Error("The new passphrases do not match.");
        await desktop.changePassphrase(current, password);
        setStatus(
          "Workspace passphrase changed. Existing backups keep their own passphrases.",
        );
      } else if (operation === "prune") {
        const result = await desktop.pruneRetention(confirmation);
        setStatus(`${result.sessionsDeleted} expired conversations removed.`);
      } else if (operation === "reset") {
        await desktop.resetVault(confirmation);
        onReset();
      }
      setPassword("");
      setCurrent("");
      setConfirmation("");
      setOperation(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="privacy-settings settings-section">
      <h3>Privacy & storage</h3>
      <p>Manage what stays on this device and keep a recoverable copy.</p>
      {sample && (
        <p className="field-hint">
          These controls work with an encrypted desktop workspace.
        </p>
      )}
      <label htmlFor="idle-lock">Lock when inactive</label>
      <select
        id="idle-lock"
        value={settings.idleLockMinutes ?? "off"}
        disabled={sample || busy}
        onChange={(event) =>
          void saveSettings({
            ...settings,
            idleLockMinutes:
              event.target.value === "off" ? null : Number(event.target.value),
          })
        }
      >
        <option value="5">After 5 minutes</option>
        <option value="15">After 15 minutes</option>
        <option value="30">After 30 minutes</option>
        <option value="60">After 1 hour</option>
        <option value="off">Never automatically</option>
      </select>
      <label htmlFor="retention">Conversation retention</label>
      <select
        id="retention"
        value={settings.retentionDays ?? "forever"}
        disabled={sample || busy}
        onChange={(event) =>
          void saveSettings({
            ...settings,
            retentionDays:
              event.target.value === "forever"
                ? null
                : Number(event.target.value),
          })
        }
      >
        <option value="forever">Keep until I delete</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365">1 year</option>
      </select>
      <p className="field-hint">
        Removing expired conversations also removes their saved notes and
        context. Backups are separate.
      </p>
      <div className="settings-action-list">
        <button onClick={() => choose("backup")} disabled={sample || busy}>
          <Download size={17} />
          <span>
            <strong>Export encrypted backup</strong>
            <small>Restore your workspace on another device.</small>
          </span>
        </button>
        <button onClick={() => choose("passphrase")} disabled={sample || busy}>
          <KeyRound size={17} />
          <span>
            <strong>Change passphrase</strong>
            <small>Choose a new way to unlock this workspace.</small>
          </span>
        </button>
        <button
          onClick={() => choose("prune")}
          disabled={sample || busy || !settings.retentionDays}
        >
          <Trash2 size={17} />
          <span>
            <strong>Remove expired conversations</strong>
            <small>Apply your retention setting now.</small>
          </span>
        </button>
        <button onClick={() => choose("reset")} disabled={sample || busy}>
          <Trash2 size={17} />
          <span>
            <strong>Delete this workspace</strong>
            <small>Remove this device’s vault and start again.</small>
          </span>
        </button>
      </div>
      {operation && (
        <form className="privacy-operation" onSubmit={execute}>
          <h4>
            {operation === "backup"
              ? "Protect your backup"
              : operation === "passphrase"
                ? "Change your passphrase"
                : operation === "prune"
                  ? "Remove expired conversations?"
                  : "Delete your workspace?"}
          </h4>
          {operation === "backup" && (
            <p>
              This passphrase unlocks the backup and becomes the workspace
              passphrase after a restore. It cannot be recovered.
            </p>
          )}
          {operation === "passphrase" && (
            <>
              <label htmlFor="old-passphrase">Current passphrase</label>
              <input
                id="old-passphrase"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                required
              />
            </>
          )}
          {operation === "backup" || operation === "passphrase" ? (
            <>
              <label htmlFor="new-passphrase">
                {operation === "backup"
                  ? "Backup passphrase"
                  : "New passphrase"}
              </label>
              <input
                id="new-passphrase"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <label htmlFor="repeat-passphrase">Confirm passphrase</label>
              <input
                id="repeat-passphrase"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </>
          ) : (
            <>
              <p>This cannot be undone. Existing backups remain unchanged.</p>
              <label htmlFor="delete-confirmation">
                Type{" "}
                {operation === "prune"
                  ? "DELETE EXPIRED CONVERSATIONS"
                  : "DELETE MY OPENMIND VAULT"}
              </label>
              <input
                id="delete-confirmation"
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </>
          )}
          <div className="note-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => choose(null)}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy
                ? "Working…"
                : operation === "backup"
                  ? "Save backup"
                  : operation === "passphrase"
                    ? "Change passphrase"
                    : "Delete permanently"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="field-hint" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
