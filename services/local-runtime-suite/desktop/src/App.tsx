import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

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

export const App = () => {
  const [status, setStatus] = useState("stopped");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [defaults, setDefaults] = useState({ llm: "", tts: "", stt: "" });
  const [preferLocal, setPreferLocal] = useState(true);
  const baseUrl = "http://127.0.0.1:8484";

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

  const llmOptions = models.filter((model) => model.metadata.api.endpoint === "responses");
  const ttsOptions = models.filter((model) => model.metadata.api.endpoint === "audio.speech");
  const sttOptions = models.filter((model) => model.metadata.api.endpoint.startsWith("audio."));

  return (
    <div className="container">
      <div className="panel header">
        <div>
          <div className="kicker">Local Runtime Suite</div>
          <div className="title">Desktop Launcher</div>
        </div>
        <span className="badge">Status: {status}</span>
      </div>

      <div className="panel">
        <div className="button-row">
          <button className="btn primary" onClick={() => invoke("start_gateway").then(refreshStatus)}>
            Start gateway
          </button>
          <button className="btn" onClick={() => invoke("stop_gateway").then(refreshStatus)}>
            Stop gateway
          </button>
          <button className="btn" onClick={refreshModels}>
            Refresh models
          </button>
          <button className="btn" onClick={refreshLogs}>
            Refresh logs
          </button>
        </div>
        <p>Base URL: {baseUrl}</p>
        <button
          className="btn"
          onClick={() => navigator.clipboard.writeText(baseUrl)}
        >
          Copy base URL
        </button>
      </div>

      <div className="panel">
        <div className="grid">
          <div>
            <div className="label">Default LLM</div>
            <select
              className="select"
              value={defaults.llm}
              onChange={(event) => setDefaults((prev) => ({ ...prev, llm: event.target.value }))}
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
        <div className="mt-4 flex items-center gap-2">
          <input
            id="prefer-local"
            type="checkbox"
            checked={preferLocal}
            onChange={(event) => setPreferLocal(event.target.checked)}
          />
          <label htmlFor="prefer-local" className="text-sm text-slate-200">
            Prefer local models over proxy providers
          </label>
        </div>
        <div className="mt-4">
          <button className="btn primary" onClick={saveConfig}>
            Save preferences
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="label">Logs</div>
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
