import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, RefreshCw, Search } from "lucide-react";
import { desktop, type MemoryIndexStatus } from "../lib/desktop";

export function MemoryIndexSettings({ sample }: { sample: boolean }) {
  const [status, setStatus] = useState<MemoryIndexStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:11434");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    void Promise.all([
      desktop.getMemoryIndexStatus(),
      desktop.getMemoryEmbeddingConfiguration(),
    ])
      .then(([nextStatus, configuration]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        if (configuration) {
          setBaseUrl(configuration.baseUrl);
          setModel(configuration.model);
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sample]);

  async function rebuild(event: FormEvent) {
    event.preventDefault();
    if (busy || sample) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await desktop.rebuildMemoryIndex(baseUrl, model.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function clearEmbedding() {
    if (busy || sample) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await desktop.clearMemoryEmbeddingConfiguration());
      setModel("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="memory-index-settings"
      aria-labelledby="memory-index-title"
    >
      <div className="settings-subheading">
        <Search size={17} />
        <div>
          <h4 id="memory-index-title">Memory search index</h4>
          <p>
            Text search stays available locally. An optional Ollama embedding
            model can improve matching without sending memories online.
          </p>
        </div>
      </div>
      {status && (
        <dl className="index-status">
          <div>
            <dt>Status</dt>
            <dd>{status.state === "ready" ? "Ready" : "Needs attention"}</dd>
          </div>
          <div>
            <dt>Text index</dt>
            <dd>
              {status.lexicalIndexed} / {status.eligibleRecords}
            </dd>
          </div>
          <div>
            <dt>Semantic index</dt>
            <dd>
              {status.semanticIndexed} indexed
              {status.staleEmbeddings
                ? ` · ${status.staleEmbeddings} stale`
                : ""}
            </dd>
          </div>
        </dl>
      )}
      <form onSubmit={rebuild}>
        <label htmlFor="embedding-endpoint">Ollama endpoint</label>
        <input
          id="embedding-endpoint"
          value={baseUrl}
          disabled={sample || busy}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <label htmlFor="embedding-model">Embedding model</label>
        <input
          id="embedding-model"
          value={model}
          disabled={sample || busy}
          placeholder="Example: nomic-embed-text"
          onChange={(event) => setModel(event.target.value)}
        />
        <div className="note-actions">
          {status?.activeEmbedding && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void clearEmbedding()}
            >
              Use text search only
            </button>
          )}
          <button
            className="secondary-button"
            disabled={sample || busy || !model.trim()}
          >
            <RefreshCw size={15} />
            {busy ? "Rebuilding…" : "Rebuild index"}
          </button>
        </div>
      </form>
      {sample && (
        <p className="field-hint">
          Index controls are available in the desktop workspace.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          <CircleAlert size={15} /> {error}
        </p>
      )}
    </section>
  );
}
