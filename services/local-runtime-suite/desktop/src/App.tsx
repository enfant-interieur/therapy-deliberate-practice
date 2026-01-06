import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

type ModelSummary = {
  id: string;
  metadata: {
    display: { title: string };
    api: { endpoint: string };
  };
};

type DoctorCheck = {
  title: string;
  status: string;
  details: string;
  fix?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type GatewayConnectionInfo = {
  port: number;
  base_url: string;
  llm_url: string;
  stt_url: string;
  endpoints: {
    health: string;
    llm_example: string;
    stt_example: string;
  };
};

type GatewayConfig = {
  port: number;
  default_models: Record<string, string>;
  prefer_local: boolean;
};

export const App = () => {
  const [status, setStatus] = useState("stopped");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [defaults, setDefaults] = useState({ llm: "", tts: "", stt: "" });
  const [preferLocal, setPreferLocal] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [port, setPort] = useState(8484);
  const [portInput, setPortInput] = useState("8484");
  const [portSaveState, setPortSaveState] = useState<SaveState>("idle");
  const [connectionInfo, setConnectionInfo] = useState<GatewayConnectionInfo | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const baseUrl = connectionInfo?.base_url ?? `http://127.0.0.1:${port}`;
  const llmUrl = connectionInfo?.llm_url ?? baseUrl;
  const sttUrl = connectionInfo?.stt_url ?? baseUrl;
  const healthUrl = connectionInfo?.endpoints.health ?? `${baseUrl}/health`;
  const llmExample = connectionInfo?.endpoints.llm_example ?? `${baseUrl}/v1/responses`;
  const sttExample =
    connectionInfo?.endpoints.stt_example ?? `${baseUrl}/v1/audio/transcriptions`;
  const settingsUrl = "https://therapy-deliberate-practice.com/settings";

  const refreshStatus = async () => {
    const result = await invoke<{ status: string }>("gateway_status");
    setStatus(result.status);
  };

  const refreshModels = async () => {
    const result = await invoke<{ data: ModelSummary[] }>("gateway_models");
    setModels(result.data ?? []);
  };

  const refreshLogs = async () => {
    const result = await invoke<{ logs: string[] }>("gateway_logs");
    setLogs(result.logs ?? []);
  };

  const refreshConnectionInfo = async () => {
    const result = await invoke<GatewayConnectionInfo>("gateway_connection_info");
    setConnectionInfo(result);
    setPort(result.port);
    setPortInput(String(result.port));
  };

  const refreshConfig = async () => {
    const result = await invoke<GatewayConfig>("gateway_config");
    setPort(result.port);
    setPortInput(String(result.port));
    setPreferLocal(result.prefer_local);
    setDefaults({
      llm: result.default_models.responses ?? "",
      tts: result.default_models["audio.speech"] ?? "",
      stt: result.default_models["audio.transcriptions"] ?? ""
    });
  };

  const saveConfig = async () => {
    setSaveState("saving");
    try {
      await invoke("save_gateway_config", {
        payload: {
          port,
          default_models: {
            responses: defaults.llm,
            "audio.speech": defaults.tts,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      setSaveState("saved");
      await refreshConnectionInfo();
    } catch (error) {
      console.error("Failed to save preferences", error);
      setSaveState("error");
    }
  };

  const savePort = async () => {
    const parsed = Number(portInput);
    if (!Number.isInteger(parsed)) return;
    setPortSaveState("saving");
    try {
      await invoke("save_gateway_config", {
        payload: {
          port: parsed,
          default_models: {
            responses: defaults.llm,
            "audio.speech": defaults.tts,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      setPort(parsed);
      setPortSaveState("saved");
      await refreshConnectionInfo();
    } catch (error) {
      console.error("Failed to save port", error);
      setPortSaveState("error");
    }
  };

  const runDoctor = async () => {
    const result = await invoke<{ checks: DoctorCheck[] }>("gateway_doctor");
    setDoctorChecks(result.checks ?? []);
  };

  const startGateway = async () => {
    setStartError(null);
    try {
      await invoke("start_gateway");
      await refreshStatus();
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : JSON.stringify(error);
      setStartError(message);
    }
  };

  const restartGateway = async () => {
    await invoke("stop_gateway");
    await startGateway();
  };

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  useEffect(() => {
    refreshStatus();
    refreshLogs();
    refreshConnectionInfo();
    refreshConfig();
    runDoctor();
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    refreshModels();
  }, [status]);

  useEffect(() => {
    setSaveState("idle");
  }, [defaults.llm, defaults.tts, defaults.stt, preferLocal]);

  useEffect(() => {
    setPortSaveState("idle");
  }, [portInput]);

  useEffect(() => {
    if (!autoScroll) return;
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const llmOptions = models.filter((model) => model.metadata.api.endpoint === "responses");
  const ttsOptions = models.filter((model) => model.metadata.api.endpoint === "audio.speech");
  const sttOptions = models.filter((model) =>
    ["audio.transcriptions", "audio.translations"].includes(model.metadata.api.endpoint)
  );

  const isGatewayRunning = status === "running";
  const portValue = Number(portInput);
  const portValid = Number.isInteger(portValue) && portValue >= 1024 && portValue <= 65535;
  const portDirty = portValue !== port;
  const doctorBlocking = doctorChecks.find(
    (check) => check.status === "error" && ["local_runtime import", "Python executable"].includes(check.title)
  );
  const canStartGateway = !doctorBlocking;
  const canLoadModels = isGatewayRunning;
  const hasModels = models.length > 0;
  const canChooseDefaults = hasModels;
  const defaultsComplete = Boolean(defaults.llm && defaults.tts && defaults.stt);
  const canSave = defaultsComplete;
  const isSaved = saveState === "saved";
  const moduleNotFound = logs.some((line) =>
    line.includes("ModuleNotFoundError: No module named 'local_runtime'")
  );

  let activeStep = 1;
  if (isGatewayRunning) activeStep = 2;
  if (hasModels) activeStep = 3;
  if (defaultsComplete) activeStep = 4;
  if (isSaved) activeStep = 5;

  const step1Description = doctorBlocking
    ? `Blocked: ${doctorBlocking.details}`
    : "Launch the local gateway so models can be discovered.";

  const steps = [
    {
      id: 1,
      title: "Start the gateway",
      description: step1Description,
      complete: isGatewayRunning
    },
    {
      id: 2,
      title: "Load/refresh models",
      description: "Pull the latest model catalog from the running gateway.",
      complete: hasModels
    },
    {
      id: 3,
      title: "Choose default LLM, TTS, STT",
      description: "Pick the defaults the suite should use for sessions.",
      complete: defaultsComplete
    },
    {
      id: 4,
      title: "Save preferences",
      description: "Persist your default selections and routing preference.",
      complete: isSaved
    }
  ];

  if (isSaved) {
    steps.push({
      id: 5,
      title: "Configure Therapy Settings",
      description: "Open the settings page to connect your saved preferences.",
      complete: false
    });
  }

  return (
    <div className="container">
      <div className="panel header">
        <div>
          <div className="kicker">Local Runtime Suite</div>
          <div className="title">Desktop Launcher</div>
        </div>
        <span className="badge">Status: {status}</span>
      </div>

      <div className="panel connection">
        <div className="header">
          <div>
            <div className="kicker">Connection</div>
            <div className="title">Local gateway URLs</div>
          </div>
          <span className="badge">Port {port}</span>
        </div>
        <div className="connection-grid">
          <div className="connection-row">
            <div className="label">Base URL</div>
            <div className="pill-row">
              <div className="pill" title={baseUrl}>{baseUrl}</div>
              <button className="icon-btn" onClick={() => copyText(baseUrl)}>
                Copy
              </button>
            </div>
          </div>
          <div className="connection-row">
            <div className="label">LLM URL</div>
            <div className="pill-row">
              <div className="pill" title={llmUrl}>{llmUrl}</div>
              <button className="icon-btn" onClick={() => copyText(llmUrl)}>
                Copy
              </button>
            </div>
          </div>
          <div className="connection-row">
            <div className="label">STT URL</div>
            <div className="pill-row">
              <div className="pill" title={sttUrl}>{sttUrl}</div>
              <button className="icon-btn" onClick={() => copyText(sttUrl)}>
                Copy
              </button>
            </div>
          </div>
        </div>
        <div className="helper-row">
          <div>
            <div className="helper-title">Where do I paste these?</div>
            <div className="helper-text">Open Therapy Settings and paste the Base URL.</div>
          </div>
          <button className="btn" onClick={() => openUrl(settingsUrl)}>
            Open Therapy Settings
          </button>
        </div>
        <div className="button-row">
          <button className="btn" onClick={() => openUrl(healthUrl)}>
            Open health check
          </button>
          <button className="btn" onClick={() => copyText(llmExample)}>
            Copy example LLM endpoint
          </button>
          <button className="btn" onClick={() => copyText(sttExample)}>
            Copy example STT endpoint
          </button>
        </div>
        <div className="port-editor">
          <div>
            <div className="label">Gateway port</div>
            <input
              className="port-input"
              type="number"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(event) => setPortInput(event.target.value)}
            />
            <div className="helper-text">
              Choose a port between 1024-65535. This updates the gateway + URLs above.
            </div>
            {!portValid ? (
              <div className="error-text">Enter a valid port between 1024 and 65535.</div>
            ) : null}
          </div>
          <div className="button-row">
            <button
              className="btn primary"
              onClick={savePort}
              disabled={!portValid || portSaveState === "saving"}
            >
              {portSaveState === "saving" ? "Saving..." : "Save port"}
            </button>
            <button className="btn" onClick={() => setPortInput("8484")}>
              Use 8484
            </button>
            {portSaveState === "error" ? (
              <span className="error-text">Port save failed. Try again.</span>
            ) : null}
            {portSaveState === "saved" ? (
              <span className="success-text">Port saved.</span>
            ) : null}
          </div>
        </div>
        {portDirty && isGatewayRunning ? (
          <div className="warning-banner">
            <div>
              Port changed. Restart the gateway to apply the new port.
            </div>
            <button className="btn" onClick={restartGateway}>
              Restart gateway
            </button>
          </div>
        ) : null}
      </div>

      <div className="panel wizard">
        <div className="header">
          <div>
            <div className="kicker">Setup Wizard</div>
            <div className="title">Get ready in minutes</div>
          </div>
          <span className="badge">Step {activeStep} of {isSaved ? 5 : 4}</span>
        </div>

        <ol className="stepper">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`step ${step.complete ? "complete" : ""} ${activeStep === step.id ? "active" : ""}`}
            >
              <div className="step-index">{step.id}</div>
              <div>
                <div className="step-title">{step.title}</div>
                <div className="step-description">{step.description}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="step-card">
          <div className="step-card-header">
            <div>
              <div className="label">Step 1</div>
              <div className="step-title">Start the gateway</div>
            </div>
            <span className={`badge ${isGatewayRunning ? "badge-success" : ""}`}>
              {isGatewayRunning ? "Gateway running" : "Gateway stopped"}
            </span>
          </div>
          <p className="step-description">
            Launch the local gateway before loading models. You can stop it anytime.
          </p>
          {doctorBlocking ? (
            <div className="warning-banner">
              <div>
                {doctorBlocking.title}: {doctorBlocking.details}
              </div>
              {doctorBlocking.fix ? <div className="helper-text">Fix: {doctorBlocking.fix}</div> : null}
              <button className="btn" onClick={runDoctor}>
                Run doctor
              </button>
            </div>
          ) : null}
          <div className="button-row">
            <button className="btn primary" onClick={startGateway} disabled={!canStartGateway}>
              Start gateway
            </button>
            <button className="btn" onClick={() => invoke("stop_gateway").then(refreshStatus)}>
              Stop gateway
            </button>
            <button className="btn" onClick={runDoctor}>
              Run doctor
            </button>
          </div>
          {startError ? (
            <div className="error-banner">
              <div>Gateway failed to start.</div>
              <div className="helper-text">{startError}</div>
            </div>
          ) : null}
        </div>

        <div className={`step-card ${canLoadModels ? "" : "is-disabled"}`}>
          <div className="step-card-header">
            <div>
              <div className="label">Step 2</div>
              <div className="step-title">Load or refresh models</div>
            </div>
            <span className="badge">{hasModels ? `${models.length} models loaded` : "No models yet"}</span>
          </div>
          <p className="step-description">
            Refresh the model list after the gateway starts. This unlocks default selections.
          </p>
          <button className="btn" onClick={refreshModels} disabled={!canLoadModels}>
            Refresh models
          </button>
        </div>

        <div className={`step-card ${canChooseDefaults ? "" : "is-disabled"}`}>
          <div className="step-card-header">
            <div>
              <div className="label">Step 3</div>
              <div className="step-title">Choose defaults</div>
            </div>
            <span className="badge">{defaultsComplete ? "Defaults selected" : "Waiting on selections"}</span>
          </div>
          <p className="step-description">
            Select your preferred LLM, TTS, and STT models to use in sessions.
          </p>
          <div className="grid">
            <div>
              <div className="label">Default LLM</div>
              <select
                className="select"
                value={defaults.llm}
                onChange={(event) => setDefaults((prev) => ({ ...prev, llm: event.target.value }))}
                disabled={!canChooseDefaults}
              >
                <option value="">Select LLM</option>
                {llmOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.metadata.display.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="label">Default TTS</div>
              <select
                className="select"
                value={defaults.tts}
                onChange={(event) => setDefaults((prev) => ({ ...prev, tts: event.target.value }))}
                disabled={!canChooseDefaults}
              >
                <option value="">Select TTS</option>
                {ttsOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.metadata.display.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="label">Default STT</div>
              <select
                className="select"
                value={defaults.stt}
                onChange={(event) => setDefaults((prev) => ({ ...prev, stt: event.target.value }))}
                disabled={!canChooseDefaults}
              >
                <option value="">Select STT</option>
                {sttOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.metadata.display.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className={`step-card ${canSave ? "" : "is-disabled"}`}>
          <div className="step-card-header">
            <div>
              <div className="label">Step 4</div>
              <div className="step-title">Save preferences</div>
            </div>
            <span className={`badge ${isSaved ? "badge-success" : ""}`}>
              {isSaved ? "Preferences saved" : "Not saved"}
            </span>
          </div>
          <p className="step-description">
            Save your defaults so the gateway uses them whenever it starts.
          </p>
          <div className="inline-row">
            <input
              id="prefer-local"
              type="checkbox"
              checked={preferLocal}
              onChange={(event) => setPreferLocal(event.target.checked)}
              disabled={!canSave}
            />
            <label htmlFor="prefer-local" className="text-sm">
              Prefer local models over proxy providers
            </label>
          </div>
          <div className="button-row">
            <button className="btn primary" onClick={saveConfig} disabled={!canSave || saveState === "saving"}>
              {saveState === "saving" ? "Saving..." : "Save preferences"}
            </button>
            {saveState === "error" ? <span className="error-text">Save failed. Try again.</span> : null}
          </div>
          {isSaved ? (
            <div className="success-panel">
              <span className="badge badge-success">Saved</span>
              <span>Your preferences are ready. Continue to Therapy Settings.</span>
            </div>
          ) : null}
        </div>

        {isSaved ? (
          <div className="step-card">
            <div className="step-card-header">
              <div>
                <div className="label">Step 5</div>
                <div className="step-title">Next: Configure in Therapy Settings</div>
              </div>
              <span className="badge">Ready</span>
            </div>
            <p className="step-description">
              Finish setup by linking these preferences in the Therapy web app.
            </p>
            <div className="button-row">
              <button className="btn primary" onClick={() => openUrl(settingsUrl)}>
                Open Therapy Settings
              </button>
              <button className="btn" onClick={() => navigator.clipboard.writeText(settingsUrl)}>
                Copy Settings Link
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="header">
          <div>
            <div className="kicker">Logs</div>
            <div className="title">Gateway output</div>
          </div>
          <div className="button-row">
            <button className="btn" onClick={refreshLogs}>
              Refresh logs
            </button>
            <button className="btn" onClick={() => copyText(logs.join("\n"))} disabled={!logs.length}>
              Copy logs
            </button>
            <button className="btn" onClick={() => setLogs([])} disabled={!logs.length}>
              Clear logs
            </button>
            <button className="btn" onClick={() => setAutoScroll((value) => !value)}>
              Auto-scroll: {autoScroll ? "On" : "Off"}
            </button>
          </div>
        </div>
        {moduleNotFound ? (
          <div className="error-banner">
            <div>
              The gateway could not import <strong>local_runtime</strong>. The Python package is
              missing from the expected path.
            </div>
            <div className="button-row">
              <button className="btn" onClick={runDoctor}>
                Run doctor
              </button>
              <button
                className="btn"
                onClick={() =>
                  copyText(
                    "Fix steps:\\n1) Set LOCAL_RUNTIME_ROOT to the local_runtime python package root.\\n2) Or bundle resources/local_runtime in the Tauri build.\\n3) Restart the gateway."
                  )
                }
              >
                Copy fix steps
              </button>
            </div>
          </div>
        ) : null}
        <div className="log-box" ref={logBoxRef}>
          {logs.length ? logs.join("\n") : "No logs yet."}
        </div>
      </div>

      <div className="panel">
        <div className="header">
          <div>
            <div className="kicker">Doctor</div>
            <div className="title">Preflight checks</div>
          </div>
          <button className="btn" onClick={runDoctor}>
            Run doctor
          </button>
        </div>
        <div className="grid">
          {doctorChecks.map((check) => (
            <div key={check.title} className="panel">
              <div className="label">{check.title}</div>
              <div>{check.details}</div>
              {check.fix ? <p>Fix: {check.fix}</p> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="label">TTS disclosure</div>
        <div className="disclosure">
          Voices generated by the local suite are AI-generated. Always disclose synthetic speech to listeners.
        </div>
      </div>
    </div>
  );
};
