#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

const MAX_LOG_LINES: usize = 500;

#[derive(serde::Deserialize)]
struct ConfigPayload {
    port: u16,
    default_models: HashMap<String, String>,
    prefer_local: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "message")]
enum GatewayError {
    SpawnFailed(String),
    Io(String),
    ConfigDir(String),
}

#[derive(Default)]
struct GatewayState {
    child: Option<Child>,
    logs: VecDeque<String>,
}

#[derive(Clone, Default)]
struct GatewayManager {
    inner: Arc<Mutex<GatewayState>>,
}

#[derive(Serialize)]
struct StatusResponse {
    status: String,
}

#[derive(Serialize)]
struct ModelsResponse {
    data: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct LogsResponse {
    logs: Vec<String>,
}

#[derive(Serialize)]
struct DoctorResponse {
    checks: Vec<serde_json::Value>,
}

impl GatewayManager {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(GatewayState::default())),
        }
    }

    fn push_log(&self, line: impl Into<String>) {
        let mut guard = self.inner.lock().expect("state lock");
        guard.logs.push_back(line.into());
        if guard.logs.len() > MAX_LOG_LINES {
            guard.logs.pop_front();
        }
    }

    fn refresh_child_state(guard: &mut GatewayState) {
        if let Some(child) = guard.child.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                guard.child = None;
            }
        }
    }

    fn start(&self) -> Result<StatusResponse, GatewayError> {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        if guard.child.is_some() {
            return Ok(StatusResponse {
                status: "running".into(),
            });
        }

        let mut child = Command::new("python")
            .args(["-m", "local_runtime.main"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| GatewayError::SpawnFailed(err.to_string()))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        guard.child = Some(child);
        drop(guard);

        self.push_log("Gateway started");

        if let Some(stream) = stdout {
            let manager = self.clone();
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stream);
                for line in reader.lines().flatten() {
                    manager.push_log(line);
                }
            });
        }

        if let Some(stream) = stderr {
            let manager = self.clone();
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stream);
                for line in reader.lines().flatten() {
                    manager.push_log(line);
                }
            });
        }

        Ok(StatusResponse {
            status: "running".into(),
        })
    }

    fn stop(&self) -> Result<StatusResponse, GatewayError> {
        let mut guard = self.inner.lock().expect("state lock");
        let child = guard.child.take();
        drop(guard);

        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
            self.push_log("Gateway stopped");
        }

        Ok(StatusResponse {
            status: "stopped".into(),
        })
    }

    fn status(&self) -> StatusResponse {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        let status = if guard.child.is_some() { "running" } else { "stopped" };
        StatusResponse {
            status: status.into(),
        }
    }

    fn logs(&self) -> LogsResponse {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        LogsResponse {
            logs: guard.logs.iter().cloned().collect(),
        }
    }
}

#[tauri::command]
fn start_gateway(state: tauri::State<GatewayManager>) -> Result<StatusResponse, GatewayError> {
    state.start()
}

#[tauri::command]
fn stop_gateway(state: tauri::State<GatewayManager>) -> Result<StatusResponse, GatewayError> {
    state.stop()
}

#[tauri::command]
fn gateway_status(state: tauri::State<GatewayManager>) -> StatusResponse {
    state.status()
}

#[tauri::command]
fn gateway_logs(state: tauri::State<GatewayManager>) -> LogsResponse {
    state.logs()
}

#[tauri::command]
fn gateway_doctor() -> DoctorResponse {
    DoctorResponse {
        checks: vec![serde_json::json!({
            "title": "Python version",
            "status": "ok",
            "details": "Check the gateway logs for any Python errors.",
            "fix": "Install Python 3.10+ if missing."
        })],
    }
}

#[tauri::command]
fn gateway_models() -> ModelsResponse {
    ModelsResponse {
        data: vec![
            serde_json::json!({
                "id": "local//llm/qwen3-hf",
                "metadata": {
                    "display": { "title": "Qwen3 Hugging Face" },
                    "api": { "endpoint": "responses" }
                }
            }),
            serde_json::json!({
                "id": "local//tts/kokoro-local",
                "metadata": {
                    "display": { "title": "Kokoro Local TTS" },
                    "api": { "endpoint": "audio.speech" }
                }
            }),
            serde_json::json!({
                "id": "local//stt/faster-whisper",
                "metadata": {
                    "display": { "title": "Faster Whisper" },
                    "api": { "endpoint": "audio.transcriptions" }
                }
            })
        ],
    }
}

#[tauri::command]
fn save_gateway_config(app: tauri::AppHandle, payload: ConfigPayload) -> Result<(), GatewayError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| GatewayError::ConfigDir(err.to_string()))?;
    let target_dir = config_dir.join("therapy").join("local-runtime");
    std::fs::create_dir_all(&target_dir).map_err(|err| GatewayError::Io(err.to_string()))?;
    let config_path = target_dir.join("config.json");
    let json = serde_json::json!({
        "port": payload.port,
        "default_models": payload.default_models,
        "prefer_local": payload.prefer_local,
        "data_dir": target_dir.join("data").to_string_lossy(),
        "cache_dir": target_dir.join("cache").to_string_lossy()
    });
    std::fs::write(config_path, serde_json::to_vec_pretty(&json).unwrap())
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(GatewayManager::new())
        .invoke_handler(tauri::generate_handler![
            start_gateway,
            stop_gateway,
            gateway_status,
            gateway_logs,
            gateway_doctor,
            gateway_models,
            save_gateway_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
