import { useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp } from "lucide-react";
import { desktop } from "../lib/desktop";

export function RestoreWorkspace({
  onRestored,
}: {
  onRestored: () => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function selectFile() {
    try {
      const file = await open({
        title: "Restore encrypted workspace",
        multiple: false,
        filters: [{ name: "Openmind backup", extensions: ["openmind"] }],
      });
      if (typeof file === "string") setPath(file);
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function restore(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await desktop.restoreBackup(path, passphrase, confirmation);
      setPassphrase("");
      await onRestored();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="settings-section" onSubmit={restore}>
      <p>
        Restore a portable encrypted backup. The backup passphrase becomes your
        workspace’s unlock passphrase.
      </p>
      <p>
        This replaces the personal workspace on this device. Export it first if
        you want to keep it.
      </p>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void selectFile()}
        disabled={busy}
      >
        <FileUp size={16} />
        Choose backup
      </button>
      {path && <p className="selected-file">{path.split(/[\\/]/).at(-1)}</p>}
      <label htmlFor="backup-passphrase">Backup passphrase</label>
      <input
        id="backup-passphrase"
        type="password"
        autoComplete="off"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        required
      />
      <label htmlFor="restore-confirmation">
        Type REPLACE MY OPENMIND VAULT
      </label>
      <input
        id="restore-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        required
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button wide"
        disabled={busy || !path || confirmation !== "REPLACE MY OPENMIND VAULT"}
      >
        {busy ? "Restoring…" : "Restore workspace"}
      </button>
    </form>
  );
}
