#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Manager;

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
    SpawnFailed(GatewayErrorDetails),
    Io(String),
    ConfigDir(String),
    Config(String),
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

#[derive(Debug, Serialize)]
struct GatewayErrorDetails {
    message: String,
    python_path: String,
    gateway_root: String,
    config_path: String,
    args: Vec<String>,
    hint: Option<String>,
}

#[derive(Clone)]
struct GatewayLaunchConfig {
    port: u16,
    python_path: String,
    gateway_root: PathBuf,
    config_path: PathBuf,
    args: Vec<String>,
}

#[derive(Serialize)]
struct GatewayConnectionInfo {
    port: u16,
    base_url: String,
    llm_url: String,
    stt_url: String,
    endpoints: GatewayEndpointExamples,
}

#[derive(Serialize)]
struct GatewayEndpointExamples {
    health: String,
    llm_example: String,
    stt_example: String,
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

#[derive(serde::Deserialize)]
struct GatewayConfigFile {
    port: Option<u16>,
    default_models: Option<HashMap<String, String>>,
    prefer_local: Option<bool>,
}

#[derive(Serialize)]
struct GatewayConfigResponse {
    port: u16,
    default_models: HashMap<String, String>,
    prefer_local: bool,
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

    fn push_notice(&self, message: impl Into<String>) {
        self.push_log(format!("launcher: {}", message.into()));
    }
}

#[tauri::command]
fn start_gateway(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>
) -> Result<StatusResponse, GatewayError> {
    state.start(&app)
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
fn gateway_doctor(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>
) -> DoctorResponse {
    let config = match build_launch_config(&app) {
        Ok(config) => config,
        Err(error) => {
            let (details, hint) = describe_gateway_error(&error);
            return DoctorResponse {
                checks: vec![serde_json::json!({
                    "title": "Gateway configuration",
                    "status": "error",
                    "details": details,
                    "fix": hint.unwrap_or_else(|| "Ensure LOCAL_RUNTIME_ROOT is set or bundle the local runtime resources.".to_string())
                })],
            };
        }
    };

    let mut checks = Vec::new();
    let python_check = Command::new(&config.python_path)
        .arg("--version")
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = if stdout.trim().is_empty() {
                stderr.trim()
            } else {
                stdout.trim()
            };
            version.to_string()
        })
        .map_err(|err| err.to_string());
    match python_check {
        Ok(version) => {
            checks.push(serde_json::json!({
                "title": "Python executable",
                "status": "ok",
                "details": if version.is_empty() { "Python is available.".to_string() } else { format!("Using {version}") },
                "fix": null
            }));
        }
        Err(error) => {
            checks.push(serde_json::json!({
                "title": "Python executable",
                "status": "error",
                "details": format!("Unable to run Python: {error}"),
                "fix": "Install Python 3.10+ or set LOCAL_RUNTIME_PYTHON to a valid interpreter."
            }));
        }
    }

    match run_python_import_check(&config) {
        Ok(path) => {
            checks.push(serde_json::json!({
                "title": "local_runtime import",
                "status": "ok",
                "details": format!("Resolved local_runtime at {path}"),
                "fix": null
            }));
        }
        Err(error) => {
            let (details, hint) = describe_gateway_error(&error);
            checks.push(serde_json::json!({
                "title": "local_runtime import",
                "status": "error",
                "details": details,
                "fix": hint.unwrap_or_else(|| "Set LOCAL_RUNTIME_ROOT to the python package root or ensure resources/local_runtime is bundled.".to_string())
            }));
        }
    }

    let status = state.status().status;
    let port_in_use = TcpListener::bind(("127.0.0.1", config.port)).is_err();
    if port_in_use && status == "running" {
        checks.push(serde_json::json!({
            "title": "Port availability",
            "status": "ok",
            "details": format!("Port {} is bound by the running gateway.", config.port),
            "fix": null
        }));
    } else if port_in_use {
        checks.push(serde_json::json!({
            "title": "Port availability",
            "status": "error",
            "details": format!("Port {} is already in use.", config.port),
            "fix": "Choose another port in the desktop app or stop the process using this port."
        }));
    } else {
        checks.push(serde_json::json!({
            "title": "Port availability",
            "status": "ok",
            "details": format!("Port {} is free.", config.port),
            "fix": null
        }));
    }

    if status == "running" {
        match http_get_localhost(config.port, "/health") {
            Ok(body) => {
                checks.push(serde_json::json!({
                    "title": "Gateway health",
                    "status": "ok",
                    "details": format!("Health check OK: {body}"),
                    "fix": null
                }));
            }
            Err(error) => {
                checks.push(serde_json::json!({
                    "title": "Gateway health",
                    "status": "warning",
                    "details": format!("Gateway responded but health check failed: {:?}", error),
                    "fix": "Open the gateway logs to inspect startup errors."
                }));
            }
        }
    } else {
        checks.push(serde_json::json!({
            "title": "Gateway health",
            "status": "warning",
            "details": "Gateway is not running yet.",
            "fix": "Start the gateway to verify health."
        }));
    }

    DoctorResponse { checks }
}

#[tauri::command]
fn gateway_models(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>
) -> ModelsResponse {
    let config = match build_launch_config(&app) {
        Ok(config) => config,
        Err(error) => {
            state.push_notice(format!("Unable to resolve gateway config: {:?}", error));
            return ModelsResponse { data: vec![] };
        }
    };

    match http_get_localhost(config.port, "/v1/models") {
        Ok(body) => {
            let payload: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let data = payload
                .get("data")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            ModelsResponse { data }
        }
        Err(error) => {
            state.push_notice(format!("Gateway models request failed: {:?}", error));
            ModelsResponse { data: vec![] }
        }
    }
}

#[tauri::command]
fn save_gateway_config(app: tauri::AppHandle, payload: ConfigPayload) -> Result<(), GatewayError> {
    let config_path = resolve_config_path(&app)?;
    let target_dir = config_path
        .parent()
        .ok_or_else(|| GatewayError::Config("Config path missing parent".into()))?;
    std::fs::create_dir_all(&target_dir).map_err(|err| GatewayError::Io(err.to_string()))?;
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

#[tauri::command]
fn gateway_config(app: tauri::AppHandle) -> Result<GatewayConfigResponse, GatewayError> {
    read_gateway_config(&app)
}

#[tauri::command]
fn gateway_connection_info(app: tauri::AppHandle) -> Result<GatewayConnectionInfo, GatewayError> {
    let config = read_gateway_config(&app)?;
    let base_url = format!("http://127.0.0.1:{}", config.port);
    Ok(GatewayConnectionInfo {
        port: config.port,
        base_url: base_url.clone(),
        llm_url: base_url.clone(),
        stt_url: base_url.clone(),
        endpoints: GatewayEndpointExamples {
            health: format!("{base_url}/health"),
            llm_example: format!("{base_url}/v1/responses"),
            stt_example: format!("{base_url}/v1/audio/transcriptions"),
        },
    })
}

fn default_python_binary() -> String {
    if cfg!(windows) {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

fn resolve_config_path(app: &tauri::AppHandle) -> Result<PathBuf, GatewayError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| GatewayError::ConfigDir(err.to_string()))?;
    Ok(config_dir.join("therapy").join("local-runtime").join("config.json"))
}

fn read_gateway_config(app: &tauri::AppHandle) -> Result<GatewayConfigResponse, GatewayError> {
    let config_path = resolve_config_path(app)?;
    if !config_path.exists() {
        return Ok(GatewayConfigResponse {
            port: 8484,
            default_models: HashMap::new(),
            prefer_local: true,
        });
    }
    let data = std::fs::read(&config_path).map_err(|err| GatewayError::Io(err.to_string()))?;
    let parsed: GatewayConfigFile =
        serde_json::from_slice(&data).map_err(|err| GatewayError::Config(err.to_string()))?;
    Ok(GatewayConfigResponse {
        port: parsed.port.unwrap_or(8484),
        default_models: parsed.default_models.unwrap_or_default(),
        prefer_local: parsed.prefer_local.unwrap_or(true),
    })
}

fn build_launch_config(app: &tauri::AppHandle) -> Result<GatewayLaunchConfig, GatewayError> {
    let config = read_gateway_config(app)?;
    let python_path =
        std::env::var("LOCAL_RUNTIME_PYTHON").unwrap_or_else(|_| default_python_binary());
    let gateway_root = resolve_gateway_root(app)?;
    let config_path = resolve_config_path(app)?;
    let args = vec![
        "-m".to_string(),
        "local_runtime.main".to_string(),
        "--port".to_string(),
        config.port.to_string(),
        "--config".to_string(),
        config_path.to_string_lossy().to_string(),
    ];
    Ok(GatewayLaunchConfig {
        port: config.port,
        python_path,
        gateway_root,
        config_path,
        args,
    })
}

fn resolve_gateway_root(app: &tauri::AppHandle) -> Result<PathBuf, GatewayError> {
    if let Ok(root) = std::env::var("LOCAL_RUNTIME_ROOT") {
        let path = PathBuf::from(root);
        if path.join("local_runtime").exists() {
            return Ok(path);
        }
        return Err(GatewayError::Config(
            "LOCAL_RUNTIME_ROOT does not contain local_runtime".into(),
        ));
    }

    if cfg!(debug_assertions) {
        let current_dir = std::env::current_dir().map_err(|err| GatewayError::Io(err.to_string()))?;
        if let Some(root) = find_gateway_root(&current_dir) {
        if root.join("local_runtime").exists() {
            return Ok(root);
        }
        return Err(GatewayError::Config(
            "Resolved gateway root is missing local_runtime".into(),
        ));
    }
        return Err(GatewayError::Config(
            "Unable to locate local_runtime package in dev mode".into(),
        ));
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| GatewayError::Config(err.to_string()))?;
    let root = resource_dir.join("local_runtime");
    if root.join("local_runtime").exists() {
        Ok(root)
    } else {
        Err(GatewayError::Config(
            "Bundled local_runtime resources missing".into(),
        ))
    }
}

fn find_gateway_root(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor
            .join("services")
            .join("local-runtime-suite")
            .join("python");
        if candidate.join("local_runtime").exists() {
            return Some(candidate);
        }
        let direct_candidate = ancestor.join("python");
        if direct_candidate.join("local_runtime").exists() {
            return Some(direct_candidate);
        }
    }
    None
}

fn build_pythonpath(gateway_root: &Path) -> Result<String, GatewayError> {
    let mut paths = vec![gateway_root.to_path_buf()];
    if let Some(existing) = std::env::var_os("PYTHONPATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    let joined =
        std::env::join_paths(paths).map_err(|err| GatewayError::Config(err.to_string()))?;
    Ok(joined.to_string_lossy().to_string())
}

fn apply_python_env(command: &mut Command, config: &GatewayLaunchConfig) -> Result<(), GatewayError> {
    let pythonpath = build_pythonpath(&config.gateway_root)?;
    command.env("PYTHONPATH", pythonpath);
    command.env("PYTHONNOUSERSITE", "1");
    Ok(())
}

fn describe_gateway_error(error: &GatewayError) -> (String, Option<String>) {
    match error {
        GatewayError::SpawnFailed(details) => (details.message.clone(), details.hint.clone()),
        GatewayError::Io(message) => (message.clone(), None),
        GatewayError::ConfigDir(message) => (message.clone(), None),
        GatewayError::Config(message) => (message.clone(), None),
    }
}

fn run_python_import_check(config: &GatewayLaunchConfig) -> Result<String, GatewayError> {
    let mut command = Command::new(&config.python_path);
    command
        .arg("-c")
        .arg("import local_runtime; print(local_runtime.__file__)")
        .current_dir(&config.gateway_root);
    apply_python_env(&mut command, config)?;
    let output = command.output().map_err(|err| {
        GatewayError::SpawnFailed(GatewayErrorDetails {
            message: err.to_string(),
            python_path: config.python_path.clone(),
            gateway_root: config.gateway_root.to_string_lossy().to_string(),
            config_path: config.config_path.to_string_lossy().to_string(),
            args: config.args.clone(),
            hint: Some(
                "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT.".to_string(),
            ),
        })
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GatewayError::SpawnFailed(GatewayErrorDetails {
            message: stderr.trim().to_string(),
            python_path: config.python_path.clone(),
            gateway_root: config.gateway_root.to_string_lossy().to_string(),
            config_path: config.config_path.to_string_lossy().to_string(),
            args: config.args.clone(),
            hint: Some(
                "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT.".to_string(),
            ),
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn http_get_localhost(port: u16, path: &str) -> Result<String, GatewayError> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|err| GatewayError::Io(err.to_string()))?;
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path, port
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    if let Some((_, body)) = response.split_once("\r\n\r\n") {
        return Ok(body.trim().to_string());
    }
    Ok(response.trim().to_string())
}

impl GatewayManager {
    fn start(&self, app: &tauri::AppHandle) -> Result<StatusResponse, GatewayError> {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        if guard.child.is_some() {
            return Ok(StatusResponse {
                status: "running".into(),
            });
        }

        let config = build_launch_config(app)?;
        run_python_import_check(&config)?;

        let mut command = Command::new(&config.python_path);
        command
            .args(&config.args)
            .current_dir(&config.gateway_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_python_env(&mut command, &config)?;

        let mut child = command
            .spawn()
            .map_err(|err| GatewayError::SpawnFailed(GatewayErrorDetails {
                message: err.to_string(),
                python_path: config.python_path.clone(),
                gateway_root: config.gateway_root.to_string_lossy().to_string(),
                config_path: config.config_path.to_string_lossy().to_string(),
                args: config.args.clone(),
                hint: Some(
                    "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT.".to_string(),
                ),
            }))?;

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
            save_gateway_config,
            gateway_config,
            gateway_connection_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
