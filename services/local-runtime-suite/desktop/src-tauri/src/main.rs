#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(serde::Deserialize)]
struct ConfigPayload {
    port: u16,
    default_models: std::collections::HashMap<String, String>,
    prefer_local: bool,
}

#[derive(Default)]
struct GatewayState {
    child: Option<Child>,
    logs: Vec<String>,
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

#[tauri::command]
fn start_gateway(state: tauri::State<Arc<Mutex<GatewayState>>>) -> StatusResponse {
    let mut guard = state.lock().expect("state lock");
    if guard.child.is_none() {
        let mut child = Command::new("python")
            .args(["-m", "local_runtime.main"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok();
        if let Some(ref mut child_proc) = child {
            guard.logs.push("Gateway started".into());
            let stdout = child_proc.stdout.take();
            let stderr = child_proc.stderr.take();
            if let Some(stream) = stdout {
                let state_clone = state.inner().clone();
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    let reader = BufReader::new(stream);
                    for line in reader.lines().flatten() {
                        let mut guard = state_clone.lock().expect("state lock");
                        guard.logs.push(line);
                    }
                });
            }
            if let Some(stream) = stderr {
                let state_clone = state.inner().clone();
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    let reader = BufReader::new(stream);
                    for line in reader.lines().flatten() {
                        let mut guard = state_clone.lock().expect("state lock");
                        guard.logs.push(line);
                    }
                });
            }
        }
        guard.child = child;
    }
    StatusResponse {
        status: "running".into(),
    }
}

#[tauri::command]
fn stop_gateway(state: tauri::State<Arc<Mutex<GatewayState>>>) -> StatusResponse {
    let mut guard = state.lock().expect("state lock");
    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        guard.logs.push("Gateway stopped".into());
    }
    StatusResponse {
        status: "stopped".into(),
    }
}

#[tauri::command]
fn gateway_status(state: tauri::State<Arc<Mutex<GatewayState>>>) -> StatusResponse {
    let guard = state.lock().expect("state lock");
    let status = if guard.child.is_some() { "running" } else { "stopped" };
    StatusResponse {
        status: status.into(),
    }
}

#[tauri::command]
fn gateway_logs(state: tauri::State<Arc<Mutex<GatewayState>>>) -> LogsResponse {
    let guard = state.lock().expect("state lock");
    LogsResponse {
        logs: guard.logs.clone(),
    }
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
fn save_gateway_config(payload: ConfigPayload) -> Result<(), String> {
    let config_dir = tauri::api::path::config_dir().ok_or("Missing config dir")?;
    let target_dir = config_dir.join("therapy").join("local-runtime");
    std::fs::create_dir_all(&target_dir).map_err(|err| err.to_string())?;
    let config_path = target_dir.join("config.json");
    let json = serde_json::json!({
        "port": payload.port,
        "default_models": payload.default_models,
        "prefer_local": payload.prefer_local,
        "data_dir": target_dir.join("data").to_string_lossy(),
        "cache_dir": target_dir.join("cache").to_string_lossy()
    });
    std::fs::write(config_path, serde_json::to_vec_pretty(&json).unwrap())
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(GatewayState::default())))
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
