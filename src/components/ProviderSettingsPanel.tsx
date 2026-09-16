import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Cpu,
  Globe,
  RefreshCw,
} from "lucide-react";
import {
  desktop,
  type ModelInfo,
  type ProviderKind,
  type ProviderSettings,
} from "../lib/desktop";

const DEFAULT: ProviderSettings = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  remoteDataConsent: false,
  credentialPresent: false,
  revision: 1,
};

export function ProviderSettingsPanel({
  sample,
  isDemo,
  onSaved,
}: {
  sample: boolean;
  isDemo: boolean;
  onSaved: (settings: ProviderSettings, ready: boolean) => void;
}) {
  const [settings, setSettings] = useState(DEFAULT);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(sample);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef(0);
  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    desktop
      .getProviderSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
          setLoaded(true);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
      request.current += 1;
    };
  }, [sample]);

  function changeProvider(provider: ProviderKind) {
    request.current += 1;
    setSettings((current) => ({
      ...current,
      provider,
      baseUrl:
        provider === "openaiCompatible"
          ? "https://api.openai.com/v1"
          : "http://127.0.0.1:11434",
      model: "",
      remoteDataConsent: false,
    }));
    setModels([]);
    setStatus("");
    setError("");
    setApiKey("");
    setClearKey(false);
    setBusy(false);
  }
  async function discover() {
    if (busy || sample) return;
    const operation = ++request.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result =
        settings.provider === "codex"
          ? await desktop.listCodexModels()
          : await desktop.listModels(settings.baseUrl);
      if (operation !== request.current) return;
      setModels(result);
      setSettings((current) => ({
        ...current,
        model: result.some((model) => model.name === current.model)
          ? current.model
          : result[0]?.name || "",
      }));
      setStatus(
        result.length
          ? `Found ${result.length} available models.`
          : "No local models are installed. Install a model in Ollama, then check again.",
      );
    } catch (reason) {
      if (operation === request.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation === request.current) setBusy(false);
    }
  }
  async function saveConnection() {
    if (busy || sample) return;
    const operation = ++request.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const saved = await desktop.updateProviderSettings(
        settings,
        apiKey || undefined,
        clearKey,
      );
      if (operation !== request.current) return;
      setSettings(saved);
      setApiKey("");
      setClearKey(false);
      onSaved(saved, false);
      const health = await desktop.checkProviderHealth();
      if (operation !== request.current) return;
      onSaved(saved, health.status === "ready");
      if (health.status !== "ready")
        throw new Error(health.message || "The connection needs attention.");
      setStatus("Connection saved. Ready for a conversation.");
    } catch (reason) {
      if (operation === request.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation === request.current) setBusy(false);
    }
  }
  const remote = settings.provider !== "ollama";
  return (
    <div className="settings-section provider-settings">
      <h3>Model connection</h3>
      <p>Choose where your AI runs. You can change this later.</p>
      <div className="provider-choices">
        <button
          disabled={sample}
          className={settings.provider === "ollama" ? "is-selected" : ""}
          aria-pressed={settings.provider === "ollama"}
          onClick={() => changeProvider("ollama")}
        >
          <Cpu size={19} />
          <strong>On this device</strong>
          <small>Local Ollama</small>
        </button>
        <button
          disabled={sample}
          className={settings.provider !== "ollama" ? "is-selected" : ""}
          aria-pressed={settings.provider !== "ollama"}
          onClick={() =>
            changeProvider(isDemo && !sample ? "codex" : "openaiCompatible")
          }
        >
          <Globe size={19} />
          <strong>Online provider</strong>
          <small>Connect your account or API</small>
        </button>
      </div>
      {remote && (
        <>
          <label htmlFor="online-provider">Provider</label>
          <select
            id="online-provider"
            value={settings.provider}
            disabled={busy}
            onChange={(event) =>
              changeProvider(event.target.value as ProviderKind)
            }
          >
            {isDemo && !sample && (
              <option value="codex">ChatGPT via Codex</option>
            )}
            <option value="openaiCompatible">OpenAI-compatible API</option>
          </select>
        </>
      )}
      {settings.provider === "codex" ? (
        <p className="field-hint">
          Uses the ChatGPT account signed in to Codex on this device.
          Subscription limits apply. This connection is available in the example
          workspace.
        </p>
      ) : (
        <>
          <label htmlFor="provider-endpoint">
            {remote ? "API base URL" : "Ollama endpoint"}
          </label>
          <input
            id="provider-endpoint"
            value={settings.baseUrl}
            disabled={sample || busy}
            spellCheck={false}
            onChange={(event) => {
              setSettings({
                ...settings,
                baseUrl: event.target.value,
                remoteDataConsent: false,
              });
              setStatus("");
              setModels([]);
            }}
          />
          <p className="field-hint">
            {remote
              ? "Use an HTTPS endpoint you trust. API usage may incur charges."
              : "Start Ollama and install a local model first. Openmind won’t download models or change Ollama’s settings."}
          </p>
        </>
      )}
      {settings.provider === "openaiCompatible" && (
        <>
          <label htmlFor="api-key">
            API key {settings.credentialPresent ? "· saved" : ""}
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder={
              settings.credentialPresent
                ? "Leave blank to keep the saved key"
                : "Enter your provider’s API key"
            }
            disabled={sample || busy}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <p className="field-hint">
            Stored inside your encrypted workspace. It is never shown again.
          </p>
          {settings.credentialPresent && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={clearKey}
                disabled={busy}
                onChange={(event) => setClearKey(event.target.checked)}
              />
              Remove saved API key
            </label>
          )}
        </>
      )}
      {settings.provider !== "openaiCompatible" && (
        <button
          className="secondary-button"
          onClick={() => void discover()}
          disabled={sample || busy || !loaded}
        >
          <RefreshCw size={15} />
          {busy ? "Checking…" : "Find available models"}
        </button>
      )}
      <label htmlFor="provider-model">Model</label>
      {models.length ? (
        <select
          id="provider-model"
          value={settings.model}
          disabled={busy}
          onChange={(event) =>
            setSettings({
              ...settings,
              model: event.target.value,
              remoteDataConsent: false,
            })
          }
        >
          {models.map((model) => (
            <option key={model.name} value={model.name}>
              {model.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="provider-model"
          value={settings.model}
          placeholder={
            settings.provider === "ollama"
              ? "Choose an installed model"
              : "Model ID"
          }
          spellCheck={false}
          disabled={sample || busy}
          onChange={(event) =>
            setSettings({
              ...settings,
              model: event.target.value,
              remoteDataConsent: false,
            })
          }
        />
      )}
      {remote && (
        <div className="remote-consent">
          <p>
            Messages, recent conversation history, retrieved memories, and text
            used for note updates will be sent to{" "}
            {settings.provider === "codex"
              ? "OpenAI through Codex"
              : settings.baseUrl || "this provider"}
            . Remote chat does not enable remote embeddings.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.remoteDataConsent}
              disabled={sample || busy}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  remoteDataConsent: event.target.checked,
                })
              }
            />
            I agree to send this data to this provider.
          </label>
        </div>
      )}
      {sample && (
        <p className="field-hint">
          Open the desktop app to connect a model. This browser workspace uses
          example conversations.
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      {status && (
        <p className="connection-success" role="status">
          <Check size={15} />
          {status}
        </p>
      )}
      <button
        className="primary-button wide"
        onClick={() => void saveConnection()}
        disabled={
          sample ||
          busy ||
          !loaded ||
          !settings.model.trim() ||
          (remote && !settings.remoteDataConsent)
        }
      >
        {busy ? "Checking connection…" : "Save and check connection"}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
