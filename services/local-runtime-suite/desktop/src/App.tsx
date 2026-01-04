import { useEffect, useState } from "react";
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

export const App = () => {
  const [status, setStatus] = useState("stopped");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [defaults, setDefaults] = useState({ llm: "", tts: "", stt: "" });
  const [preferLocal, setPreferLocal] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const baseUrl = "http://127.0.0.1:8484";
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

  const saveConfig = async () => {
    setSaveState("saving");
    try {
      await invoke("save_gateway_config", {
        payload: {
          port: 8484,
          default_models: {
            responses: defaults.llm,
            "audio.speech": defaults.tts,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      setSaveState("saved");
    } catch (error) {
      console.error("Failed to save preferences", error);
      setSaveState("error");
    }
  };

  const runDoctor = async () => {
    const result = await invoke<{ checks: DoctorCheck[] }>("gateway_doctor");
    setDoctorChecks(result.checks ?? []);
  };

  useEffect(() => {
    refreshStatus();
    refreshModels();
    refreshLogs();
  }, []);

  useEffect(() => {
    setSaveState("idle");
  }, [defaults.llm, defaults.tts, defaults.stt, preferLocal]);

  const llmOptions = models.filter((model) => model.metadata.api.endpoint === "responses");
  const ttsOptions = models.filter((model) => model.metadata.api.endpoint === "audio.speech");
  const sttOptions = models.filter((model) => model.metadata.api.endpoint.startsWith("audio."));

  const isGatewayRunning = status === "running";
  const canLoadModels = isGatewayRunning;
  const hasModels = models.length > 0;
  const canChooseDefaults = hasModels;
  const defaultsComplete = Boolean(defaults.llm && defaults.tts && defaults.stt);
  const canSave = defaultsComplete;
  const isSaved = saveState === "saved";

  let activeStep = 1;
  if (isGatewayRunning) activeStep = 2;
  if (hasModels) activeStep = 3;
  if (defaultsComplete) activeStep = 4;
  if (isSaved) activeStep = 5;

  const steps = [
    {
      id: 1,
      title: "Start the gateway",
      description: "Launch the local gateway so models can be discovered.",
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
          <div className="button-row">
            <button className="btn primary" onClick={() => invoke("start_gateway").then(refreshStatus)}>
              Start gateway
            </button>
            <button className="btn" onClick={() => invoke("stop_gateway").then(refreshStatus)}>
              Stop gateway
            </button>
          </div>
          <div className="inline-row">
            <span>Base URL: {baseUrl}</span>
            <button className="btn" onClick={() => navigator.clipboard.writeText(baseUrl)}>
              Copy base URL
            </button>
          </div>
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
          <button className="btn" onClick={refreshLogs}>
            Refresh logs
          </button>
        </div>
        <div className="log-box">
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
