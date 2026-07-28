#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const MAX_LOG_LINES: usize = 500;
const GATEWAY_SERVICE_ID: &str = "therapy-local-runtime";
const GATEWAY_PROTOCOL_VERSION: &str = "1";
const GATEWAY_HTTP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(serde::Deserialize)]
struct ConfigPayload {
    port: u16,
    default_models: HashMap<String, String>,
    prefer_local: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "message")]
enum GatewayError {
    SpawnFailed(Box<GatewayErrorDetails>),
    Io(String),
    ConfigDir(String),
    Config(String),
}

#[derive(Default)]
struct GatewayState {
    child: Option<GatewayChild>,
    child_port: Option<u16>,
    child_generation: u64,
    orphaned_sidecar: Option<(u32, u16)>,
    logs: VecDeque<String>,
}

#[derive(Clone, Default)]
struct GatewayManager {
    inner: Arc<Mutex<GatewayState>>,
}

#[derive(Debug, Serialize)]
struct GatewayErrorDetails {
    message: String,
    launcher: String,
    gateway_root: Option<String>,
    config_path: String,
    args: Vec<String>,
    hint: Option<String>,
}

#[derive(Clone, Copy, Debug)]
enum GatewayLaunchMode {
    Sidecar,
    Python,
}

enum GatewayChild {
    Sidecar(tauri_plugin_shell::process::CommandChild),
    Python(Child),
}

#[derive(Clone)]
struct GatewayLaunchConfig {
    mode: GatewayLaunchMode,
    port: u16,
    access_token: String,
    python_path: Option<String>,
    gateway_root: Option<PathBuf>,
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

#[derive(Debug, Serialize)]
struct GatewayStoragePaths {
    config_file: String,
    data_dir: String,
    cache_dir: String,
    logging_policy: &'static str,
}

#[derive(Debug, Serialize)]
struct StatusResponse {
    status: String,
}

#[derive(Serialize)]
struct ModelsResponse {
    data: Vec<serde_json::Value>,
}

#[derive(Serialize)]
struct GatewayRuntimeStateResponse {
    platform_id: Option<String>,
    defaults: HashMap<String, String>,
    loaded_models: Vec<String>,
}

#[derive(serde::Deserialize)]
struct LoadModelsCommandPayload {
    models: Vec<String>,
}

#[derive(serde::Deserialize)]
struct LoadJobCommandPayload {
    job_id: String,
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
    data_dir: Option<String>,
    cache_dir: Option<String>,
    prefer_local: Option<bool>,
    access_token: Option<String>,
}

#[derive(Clone, Serialize)]
struct GatewayConfigResponse {
    port: u16,
    default_models: HashMap<String, String>,
    data_dir: String,
    cache_dir: String,
    prefer_local: bool,
    #[serde(skip_serializing)]
    access_token: String,
}

#[derive(Debug, Serialize)]
struct PairingTokenResponse {
    token: String,
    masked: String,
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
            match child {
                GatewayChild::Python(child) => {
                    if let Ok(Some(_)) = child.try_wait() {
                        guard.child = None;
                        guard.child_port = None;
                    }
                }
                GatewayChild::Sidecar(_) => {}
            }
        }
    }

    fn stop(&self, configured_port: Option<u16>) -> Result<StatusResponse, GatewayError> {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        let child = guard.child.take();
        let child_port = guard.child_port.take();
        let orphaned_sidecar = guard.orphaned_sidecar.take();
        drop(guard);
        let port = child_port
            .or_else(|| orphaned_sidecar.map(|(_, port)| port))
            .or(configured_port);
        let Some(port) = port else {
            let mut guard = self.inner.lock().expect("state lock");
            guard.child = child;
            guard.child_port = child_port;
            guard.orphaned_sidecar = orphaned_sidecar;
            return if guard.child.is_some() || guard.orphaned_sidecar.is_some() {
                Err(GatewayError::Config(
                    "The desktop app owns a gateway process but no longer knows which port it uses."
                        .into(),
                ))
            } else {
                Ok(StatusResponse {
                    status: "stopped".into(),
                })
            };
        };
        let mut sidecar_to_recover = orphaned_sidecar;

        match child {
            Some(GatewayChild::Python(mut child)) => {
                if let Err(error) = terminate_python_child(&mut child, Duration::from_secs(5)) {
                    let mut guard = self.inner.lock().expect("state lock");
                    guard.child = Some(GatewayChild::Python(child));
                    guard.child_port = Some(port);
                    return Err(GatewayError::Io(format!(
                        "Could not stop the Python gateway process: {error}"
                    )));
                }
            }
            Some(GatewayChild::Sidecar(child)) => {
                let pid = child.pid();
                sidecar_to_recover = Some((pid, port));
                if let Err(error) = child.kill() {
                    let mut guard = self.inner.lock().expect("state lock");
                    guard.orphaned_sidecar = Some((pid, port));
                    return Err(GatewayError::Io(format!(
                        "Could not stop the sidecar process (PID {pid}): {error}"
                    )));
                }
            }
            None if orphaned_sidecar.is_some() => {
                let (pid, _) = orphaned_sidecar.expect("checked above");
                if let Err(error) = terminate_process_by_pid(pid) {
                    let mut guard = self.inner.lock().expect("state lock");
                    guard.orphaned_sidecar = Some((pid, port));
                    return Err(GatewayError::Io(format!(
                        "Could not stop the previously orphaned sidecar process (PID {pid}): {error}"
                    )));
                }
            }
            None => {
                if !loopback_port_is_closed(port) {
                    return Err(GatewayError::Config(format!(
                        "A process is listening on port {port}, but it is not owned by this desktop app and cannot be stopped here."
                    )));
                }
                return Ok(StatusResponse {
                    status: "stopped".into(),
                });
            }
        }

        if !wait_for_loopback_port_closed(port, Duration::from_secs(5)) {
            if let Some((pid, owned_port)) = sidecar_to_recover {
                let mut guard = self.inner.lock().expect("state lock");
                guard.orphaned_sidecar = Some((pid, owned_port));
            }
            return Err(GatewayError::Io(format!(
                "The gateway process was signalled to stop, but port {port} is still accepting connections."
            )));
        }

        self.push_log("Gateway stopped");
        Ok(StatusResponse {
            status: "stopped".into(),
        })
    }

    fn status(&self) -> StatusResponse {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        let status = if guard.child.is_some() {
            "starting"
        } else {
            "stopped"
        };
        StatusResponse {
            status: status.into(),
        }
    }

    fn status_with_health(&self, port: u16) -> StatusResponse {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        let has_tracked_child = guard.child.is_some();
        let orphaned_sidecar = guard.orphaned_sidecar;
        let has_orphaned_sidecar = orphaned_sidecar.is_some();
        let effective_port = guard
            .child_port
            .or_else(|| orphaned_sidecar.map(|(_, port)| port))
            .unwrap_or(port);
        drop(guard);

        if gateway_health(effective_port).is_ok() {
            StatusResponse {
                status: "running".into(),
            }
        } else if has_tracked_child
            || (has_orphaned_sidecar && !loopback_port_is_closed(effective_port))
        {
            StatusResponse {
                status: "starting".into(),
            }
        } else {
            if has_orphaned_sidecar {
                let mut guard = self.inner.lock().expect("state lock");
                guard.orphaned_sidecar = None;
            }
            StatusResponse {
                status: "stopped".into(),
            }
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

    fn clear_child_if_generation(&self, generation: u64) {
        let mut guard = self.inner.lock().expect("state lock");
        if guard.child_generation == generation {
            guard.child = None;
            guard.child_port = None;
            guard.orphaned_sidecar = None;
        }
    }

    fn owns_gateway_process(&self) -> bool {
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        guard.child.is_some() || guard.orphaned_sidecar.is_some()
    }
}

fn loopback_port_is_closed(port: u16) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_err()
}

fn wait_for_loopback_port_closed(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if loopback_port_is_closed(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    loopback_port_is_closed(port)
}

fn wait_for_gateway_ready(port: u16, timeout: Duration) -> Result<(), GatewayError> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if gateway_health(port).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    gateway_health(port).map(|_| ()).map_err(|error| {
        GatewayError::Io(format!(
            "The gateway did not become ready after restart: {error:?}"
        ))
    })
}

fn terminate_python_child(child: &mut Child, timeout: Duration) -> std::io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }
    if let Err(kill_error) = child.kill() {
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        return Err(kill_error);
    }

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "process did not exit after termination",
    ))
}

#[cfg(unix)]
fn terminate_process_by_pid(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("kill exited with status {status}"))
    }
}

#[cfg(windows)]
fn terminate_process_by_pid(pid: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill exited with status {status}"))
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_by_pid(_pid: u32) -> Result<(), String> {
    Err("process termination is unsupported on this platform".into())
}

#[tauri::command]
fn start_gateway(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>,
) -> Result<StatusResponse, GatewayError> {
    state.start(&app)
}

#[tauri::command]
fn stop_gateway(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>,
) -> Result<StatusResponse, GatewayError> {
    let configured_port = build_launch_config(&app).ok().map(|config| config.port);
    state.stop(configured_port)
}

#[tauri::command]
fn gateway_status(app: tauri::AppHandle, state: tauri::State<GatewayManager>) -> StatusResponse {
    if let Ok(config) = build_launch_config(&app) {
        state.status_with_health(config.port)
    } else {
        state.status()
    }
}

#[tauri::command]
fn gateway_logs(state: tauri::State<GatewayManager>) -> LogsResponse {
    state.logs()
}

#[tauri::command]
fn gateway_doctor(app: tauri::AppHandle, state: tauri::State<GatewayManager>) -> DoctorResponse {
    let config = match build_launch_config(&app) {
        Ok(config) => config,
        Err(error) => {
            let (details, _) = describe_gateway_error(&error);
            return DoctorResponse {
                checks: vec![serde_json::json!({
                    "code": "gateway_configuration",
                    "status": "error",
                    "details": details,
                })],
            };
        }
    };

    let mut checks = Vec::new();
    match config.mode {
        GatewayLaunchMode::Python => {
            let python_path = config
                .python_path
                .as_ref()
                .map(|path| path.to_string())
                .unwrap_or_else(default_python_binary);
            let python_check = Command::new(&python_path)
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
                    checks.push(serde_json::json!( {
                        "code": "python_executable",
                        "status": "ok",
                        "details": if version.is_empty() { None } else { Some(version) },
                    }));
                }
                Err(error) => {
                    checks.push(serde_json::json!( {
                        "code": "python_executable",
                        "status": "error",
                        "details": error,
                    }));
                }
            }

            match run_python_import_check(&config) {
                Ok(path) => {
                    checks.push(serde_json::json!( {
                        "code": "local_runtime_import",
                        "status": "ok",
                        "details": path,
                    }));
                }
                Err(error) => {
                    let (details, _) = describe_gateway_error(&error);
                    checks.push(serde_json::json!( {
                        "code": "local_runtime_import",
                        "status": "error",
                        "details": details,
                    }));
                }
            }
        }
        GatewayLaunchMode::Sidecar => match resolve_sidecar_path(&app) {
            Some(path) => {
                checks.push(serde_json::json!( {
                    "code": "gateway_sidecar_binary",
                    "status": "ok",
                    "details": path.display().to_string(),
                }));

                if !is_executable(&path) {
                    checks.push(serde_json::json!( {
                        "code": "gateway_sidecar_permissions",
                        "status": "error",
                        "details": path.display().to_string(),
                    }));
                }
            }
            None => {
                checks.push(serde_json::json!( {
                    "code": "gateway_sidecar_binary",
                    "status": "error",
                    "details": null,
                }));
            }
        },
    }

    let status = state.status_with_health(config.port).status;
    let port_in_use = TcpListener::bind(("127.0.0.1", config.port)).is_err();
    if port_in_use && status == "running" {
        checks.push(serde_json::json!({
            "code": "port_availability",
            "status": "ok",
            "port": config.port,
            "gateway_status": status,
        }));
    } else if port_in_use {
        checks.push(serde_json::json!({
            "code": "port_availability",
            "status": if status == "starting" { "warning" } else { "error" },
            "port": config.port,
            "gateway_status": status,
        }));
    } else {
        checks.push(serde_json::json!({
            "code": "port_availability",
            "status": "ok",
            "port": config.port,
            "gateway_status": "free",
        }));
    }

    if status == "running" {
        match gateway_health(config.port) {
            Ok(health) => {
                checks.push(serde_json::json!({
                    "code": "gateway_health",
                    "status": "ok",
                    "details": health.body,
                    "gateway_status": status,
                }));
            }
            Err(error) => {
                checks.push(serde_json::json!({
                    "code": "gateway_health",
                    "status": "warning",
                    "details": format!("{error:?}"),
                    "gateway_status": status,
                }));
            }
        }
    } else {
        checks.push(serde_json::json!({
            "code": "gateway_health",
            "status": "warning",
            "details": null,
            "gateway_status": status,
        }));
    }

    DoctorResponse { checks }
}

#[tauri::command]
fn gateway_models(app: tauri::AppHandle, state: tauri::State<GatewayManager>) -> ModelsResponse {
    let config = match build_launch_config(&app) {
        Ok(config) => config,
        Err(error) => {
            state.push_notice(format!("Unable to resolve gateway config: {:?}", error));
            return ModelsResponse { data: vec![] };
        }
    };

    if let Err(error) = gateway_health(config.port) {
        state.push_notice(format!("Gateway identity check failed: {:?}", error));
        return ModelsResponse { data: vec![] };
    }
    match http_get_localhost(config.port, "/v1/models", Some(&config.access_token)) {
        Ok(response) if (200..300).contains(&response.status) => {
            let payload: serde_json::Value =
                serde_json::from_str(&response.body).unwrap_or_default();
            let data = payload
                .get("data")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            ModelsResponse { data }
        }
        Ok(response) => {
            state.push_notice(format!(
                "Gateway models request returned HTTP {}",
                response.status
            ));
            ModelsResponse { data: vec![] }
        }
        Err(error) => {
            state.push_notice(format!("Gateway models request failed: {:?}", error));
            ModelsResponse { data: vec![] }
        }
    }
}

#[tauri::command]
fn gateway_runtime_state(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>,
) -> Result<GatewayRuntimeStateResponse, GatewayError> {
    let config = build_launch_config(&app)?;
    gateway_health(config.port)?;
    let response = http_get_localhost(config.port, "/health/details", Some(&config.access_token))?;
    let payload = parse_gateway_json(response, "runtime state")?;
    validate_gateway_identity_payload(&payload)?;
    let defaults: HashMap<String, String> = payload
        .get("defaults")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| GatewayError::Io(format!("Invalid gateway defaults: {error}")))?
        .unwrap_or_default();
    let loaded_models: Vec<String> = payload
        .get("loaded_models")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| GatewayError::Io(format!("Invalid loaded-model state: {error}")))?
        .unwrap_or_default();
    state.push_notice(format!(
        "Gateway reports {} model(s) loaded.",
        loaded_models.len()
    ));
    Ok(GatewayRuntimeStateResponse {
        platform_id: payload
            .get("platform_id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        defaults,
        loaded_models,
    })
}

#[tauri::command]
fn gateway_load_models(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>,
    payload: LoadModelsCommandPayload,
) -> Result<serde_json::Value, GatewayError> {
    let models = validate_model_ids(payload.models)?;
    let config = build_launch_config(&app)?;
    gateway_health(config.port)?;
    let body = serde_json::to_string(&serde_json::json!({ "models": models }))
        .map_err(|error| GatewayError::Config(error.to_string()))?;
    let response =
        http_post_json_localhost(config.port, "/load_models", &config.access_token, &body)?;
    let value = parse_gateway_json(response, "model-load request")?;
    state.push_notice("Started selected model download/load job.");
    Ok(value)
}

#[tauri::command]
fn gateway_model_load_status(
    app: tauri::AppHandle,
    payload: LoadJobCommandPayload,
) -> Result<serde_json::Value, GatewayError> {
    validate_load_job_id(&payload.job_id)?;
    let config = build_launch_config(&app)?;
    gateway_health(config.port)?;
    let path = format!("/load_models/{}", payload.job_id);
    let response = http_get_localhost(config.port, &path, Some(&config.access_token))?;
    parse_gateway_json(response, "model-load status")
}

#[tauri::command]
fn save_gateway_config(app: tauri::AppHandle, payload: ConfigPayload) -> Result<(), GatewayError> {
    let config_path = resolve_config_path(&app)?;
    let existing = read_gateway_config(&app)?;
    let has_complete_defaults = payload.default_models.contains_key("responses")
        && payload.default_models.contains_key("audio.transcriptions");
    if has_complete_defaults && gateway_health(existing.port).is_ok() {
        let body = serde_json::to_string(&serde_json::json!({
            "port": payload.port,
            "default_models": payload.default_models,
            "prefer_local": payload.prefer_local,
        }))
        .map_err(|error| GatewayError::Config(error.to_string()))?;
        let response = http_post_json_localhost(
            existing.port,
            "/runtime/config",
            &existing.access_token,
            &body,
        )?;
        parse_gateway_json(response, "configuration update")?;
        return Ok(());
    }
    write_gateway_config(
        &config_path,
        payload.port,
        &payload.default_models,
        &existing.data_dir,
        &existing.cache_dir,
        payload.prefer_local,
        &existing.access_token,
    )
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

fn storage_paths_from_config(
    config_path: &Path,
    config: &GatewayConfigResponse,
) -> GatewayStoragePaths {
    GatewayStoragePaths {
        config_file: config_path.to_string_lossy().into_owned(),
        data_dir: config.data_dir.clone(),
        cache_dir: config.cache_dir.clone(),
        logging_policy: "metadata_only",
    }
}

#[tauri::command]
fn gateway_storage_paths(app: tauri::AppHandle) -> Result<GatewayStoragePaths, GatewayError> {
    let config_path = resolve_config_path(&app)?;
    let config = read_gateway_config(&app)?;
    Ok(storage_paths_from_config(&config_path, &config))
}

#[tauri::command]
fn gateway_pairing_token(app: tauri::AppHandle) -> Result<PairingTokenResponse, GatewayError> {
    let config = read_gateway_config(&app)?;
    Ok(pairing_token_response(config.access_token))
}

#[tauri::command]
fn rotate_gateway_pairing_token(
    app: tauri::AppHandle,
    state: tauri::State<GatewayManager>,
) -> Result<PairingTokenResponse, GatewayError> {
    let config_path = resolve_config_path(&app)?;
    let config = read_gateway_config(&app)?;
    let was_running = state.owns_gateway_process() || gateway_health(config.port).is_ok();
    let new_token = generate_access_token()?;
    rotate_pairing_token_transaction(
        &config_path,
        &config,
        new_token,
        was_running,
        || state.stop(Some(config.port)).map(|_| ()),
        || {
            state.start(&app)?;
            wait_for_gateway_ready(config.port, Duration::from_secs(30))
        },
    )
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
    Ok(config_dir
        .join("therapy")
        .join("local-runtime")
        .join("config.json"))
}

fn resolve_configured_directory(
    config_parent: &Path,
    configured: Option<String>,
    fallback_name: &str,
) -> (String, bool) {
    match configured.filter(|path| !path.trim().is_empty()) {
        Some(path) if Path::new(&path).is_absolute() => (path, false),
        Some(path) => (
            config_parent.join(path).to_string_lossy().into_owned(),
            true,
        ),
        None => (
            config_parent
                .join(fallback_name)
                .to_string_lossy()
                .into_owned(),
            true,
        ),
    }
}

fn read_gateway_config(app: &tauri::AppHandle) -> Result<GatewayConfigResponse, GatewayError> {
    let config_path = resolve_config_path(app)?;
    let parsed = if config_path.exists() {
        let data = std::fs::read(&config_path).map_err(|err| GatewayError::Io(err.to_string()))?;
        serde_json::from_slice::<GatewayConfigFile>(&data)
            .map_err(|err| GatewayError::Config(err.to_string()))?
    } else {
        GatewayConfigFile {
            port: None,
            default_models: None,
            data_dir: None,
            cache_dir: None,
            prefer_local: None,
            access_token: None,
        }
    };
    let GatewayConfigFile {
        port,
        default_models,
        data_dir,
        cache_dir,
        prefer_local,
        access_token,
    } = parsed;
    let target_dir = config_path
        .parent()
        .ok_or_else(|| GatewayError::Config("Config path missing parent".into()))?;
    let (resolved_data_dir, data_dir_needs_write) =
        resolve_configured_directory(target_dir, data_dir, "data");
    let (resolved_cache_dir, cache_dir_needs_write) =
        resolve_configured_directory(target_dir, cache_dir, "cache");
    let existing_token = access_token.filter(|token| is_valid_access_token(token));
    let needs_write = !config_path.exists()
        || existing_token.is_none()
        || data_dir_needs_write
        || cache_dir_needs_write;
    let response = GatewayConfigResponse {
        port: port.unwrap_or(8484),
        default_models: default_models.unwrap_or_default(),
        data_dir: resolved_data_dir,
        cache_dir: resolved_cache_dir,
        prefer_local: prefer_local.unwrap_or(true),
        access_token: match existing_token {
            Some(token) => token,
            None => generate_access_token()?,
        },
    };
    if needs_write {
        write_gateway_config(
            &config_path,
            response.port,
            &response.default_models,
            &response.data_dir,
            &response.cache_dir,
            response.prefer_local,
            &response.access_token,
        )?;
    }
    Ok(response)
}

fn generate_access_token() -> Result<String, GatewayError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| GatewayError::Config(format!("Unable to create pairing key: {error}")))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn is_valid_access_token(token: &str) -> bool {
    (32..=256).contains(&token.len())
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn pairing_token_response(token: String) -> PairingTokenResponse {
    let suffix_start = token.len().saturating_sub(6);
    PairingTokenResponse {
        masked: format!("••••••••••••{}", &token[suffix_start..]),
        token,
    }
}

fn rotate_pairing_token_transaction<Stop, Start>(
    config_path: &Path,
    current: &GatewayConfigResponse,
    new_token: String,
    was_running: bool,
    mut stop: Stop,
    mut start_and_wait: Start,
) -> Result<PairingTokenResponse, GatewayError>
where
    Stop: FnMut() -> Result<(), GatewayError>,
    Start: FnMut() -> Result<(), GatewayError>,
{
    if was_running {
        stop()?;
    }

    let write_new_result = write_gateway_config(
        config_path,
        current.port,
        &current.default_models,
        &current.data_dir,
        &current.cache_dir,
        current.prefer_local,
        &new_token,
    );
    if let Err(write_error) = write_new_result {
        let restore_result = write_gateway_config(
            config_path,
            current.port,
            &current.default_models,
            &current.data_dir,
            &current.cache_dir,
            current.prefer_local,
            &current.access_token,
        )
        .and_then(|_| {
            if was_running {
                start_and_wait()
            } else {
                Ok(())
            }
        });
        return match restore_result {
            Ok(()) => Err(write_error),
            Err(restore_error) => Err(GatewayError::Config(format!(
                "Pairing-key rotation failed and the previous gateway state could not be restored: \
                 rotation error: {write_error:?}; recovery error: {restore_error:?}"
            ))),
        };
    }

    if was_running {
        if let Err(start_error) = start_and_wait() {
            let stop_error = stop().err();
            let restore_result = write_gateway_config(
                config_path,
                current.port,
                &current.default_models,
                &current.data_dir,
                &current.cache_dir,
                current.prefer_local,
                &current.access_token,
            )
            .and_then(|_| start_and_wait());
            return match restore_result {
                Ok(()) => Err(GatewayError::Config(format!(
                    "Pairing-key rotation failed, so the previous key was restored and the gateway \
                     was restarted: {start_error:?}"
                ))),
                Err(restore_error) => Err(GatewayError::Config(format!(
                    "Pairing-key rotation failed and the previous gateway state could not be \
                     restored: start error: {start_error:?}; cleanup error: {stop_error:?}; \
                     recovery error: {restore_error:?}"
                ))),
            };
        }
    }

    Ok(pairing_token_response(new_token))
}

fn write_gateway_config(
    config_path: &Path,
    port: u16,
    default_models: &HashMap<String, String>,
    data_dir: &str,
    cache_dir: &str,
    prefer_local: bool,
    access_token: &str,
) -> Result<(), GatewayError> {
    let target_dir = config_path
        .parent()
        .ok_or_else(|| GatewayError::Config("Config path missing parent".into()))?;
    std::fs::create_dir_all(target_dir).map_err(|err| GatewayError::Io(err.to_string()))?;
    #[cfg(unix)]
    std::fs::set_permissions(target_dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|err| GatewayError::Io(err.to_string()))?;

    let json = serde_json::json!({
        "port": port,
        "default_models": default_models,
        "prefer_local": prefer_local,
        "access_token": access_token,
        "data_dir": data_dir,
        "cache_dir": cache_dir
    });
    let mut serialized =
        serde_json::to_vec_pretty(&json).map_err(|err| GatewayError::Config(err.to_string()))?;
    serialized.push(b'\n');
    AtomicFile::new(config_path, AllowOverwrite)
        .write(|file| file.write_all(&serialized))
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    #[cfg(unix)]
    std::fs::set_permissions(config_path, std::fs::Permissions::from_mode(0o600))
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    Ok(())
}

fn build_launch_config(app: &tauri::AppHandle) -> Result<GatewayLaunchConfig, GatewayError> {
    let config = read_gateway_config(app)?;
    let config_path = resolve_config_path(app)?;
    let args = vec![
        "--port".to_string(),
        config.port.to_string(),
        "--config".to_string(),
        config_path.to_string_lossy().to_string(),
    ];
    let forced_mode = std::env::var("LOCAL_RUNTIME_LAUNCH").ok();
    let prefer_sidecar = forced_mode
        .as_deref()
        .map(|mode| mode == "sidecar")
        .unwrap_or(false);
    let prefer_python = forced_mode
        .as_deref()
        .map(|mode| mode == "python")
        .unwrap_or(false);
    let sidecar_available =
        resolve_sidecar_path(app).is_some() && resolve_sidecar_command(app).is_ok();
    let mode = if cfg!(debug_assertions) {
        if prefer_python {
            GatewayLaunchMode::Python
        } else if prefer_sidecar || sidecar_available {
            GatewayLaunchMode::Sidecar
        } else {
            GatewayLaunchMode::Python
        }
    } else {
        GatewayLaunchMode::Sidecar
    };

    if matches!(mode, GatewayLaunchMode::Sidecar) && !sidecar_available {
        return Err(GatewayError::Config(
            "Gateway sidecar is missing; run `npm run sidecar:build` or ensure tauri.sidecar.conf.json is included.".into(),
        ));
    }

    match mode {
        GatewayLaunchMode::Sidecar => Ok(GatewayLaunchConfig {
            mode,
            port: config.port,
            access_token: config.access_token,
            python_path: None,
            gateway_root: None,
            config_path,
            args,
        }),
        GatewayLaunchMode::Python => {
            let python_path =
                std::env::var("LOCAL_RUNTIME_PYTHON").unwrap_or_else(|_| default_python_binary());
            let gateway_root = resolve_gateway_root(app)?;
            let mut python_args = vec!["-m".to_string(), "local_runtime.main".to_string()];
            python_args.extend(args.clone());
            Ok(GatewayLaunchConfig {
                mode,
                port: config.port,
                access_token: config.access_token,
                python_path: Some(python_path),
                gateway_root: Some(gateway_root),
                config_path,
                args: python_args,
            })
        }
    }
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
        let current_dir =
            std::env::current_dir().map_err(|err| GatewayError::Io(err.to_string()))?;
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

fn apply_python_env(
    command: &mut Command,
    config: &GatewayLaunchConfig,
) -> Result<(), GatewayError> {
    let gateway_root = config
        .gateway_root
        .as_ref()
        .ok_or_else(|| GatewayError::Config("Missing gateway root for python launch".into()))?;
    let pythonpath = build_pythonpath(gateway_root)?;
    command.env("PYTHONPATH", pythonpath);
    command.env("PYTHONNOUSERSITE", "1");
    if cfg!(debug_assertions) {
        command.env("LOCAL_RUNTIME_RELOAD", "1");
    }
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
    let python_path = config
        .python_path
        .as_ref()
        .ok_or_else(|| GatewayError::Config("Missing python path for python launch".into()))?;
    let gateway_root = config
        .gateway_root
        .as_ref()
        .ok_or_else(|| GatewayError::Config("Missing gateway root for python launch".into()))?;
    let mut command = Command::new(python_path);
    command
        .arg("-c")
        .arg("import local_runtime; print(local_runtime.__file__)")
        .current_dir(gateway_root);
    apply_python_env(&mut command, config)?;
    let output = command.output().map_err(|err| {
        GatewayError::SpawnFailed(Box::new(GatewayErrorDetails {
            message: err.to_string(),
            launcher: python_path.to_string(),
            gateway_root: Some(gateway_root.to_string_lossy().to_string()),
            config_path: config.config_path.to_string_lossy().to_string(),
            args: config.args.clone(),
            hint: Some(
                "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT.".to_string(),
            ),
        }))
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GatewayError::SpawnFailed(Box::new(GatewayErrorDetails {
            message: stderr.trim().to_string(),
            launcher: python_path.to_string(),
            gateway_root: Some(gateway_root.to_string_lossy().to_string()),
            config_path: config.config_path.to_string_lossy().to_string(),
            args: config.args.clone(),
            hint: Some(
                "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT.".to_string(),
            ),
        })));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

struct LocalHttpResponse {
    status: u16,
    body: String,
}

fn http_get_localhost(
    port: u16,
    path: &str,
    access_token: Option<&str>,
) -> Result<LocalHttpResponse, GatewayError> {
    http_request_localhost(port, "GET", path, access_token, None)
}

fn http_post_json_localhost(
    port: u16,
    path: &str,
    access_token: &str,
    body: &str,
) -> Result<LocalHttpResponse, GatewayError> {
    http_request_localhost(port, "POST", path, Some(access_token), Some(body))
}

fn http_request_localhost(
    port: u16,
    method: &str,
    path: &str,
    access_token: Option<&str>,
    body: Option<&str>,
) -> Result<LocalHttpResponse, GatewayError> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|err| GatewayError::Io(err.to_string()))?;
    let timeout = Some(GATEWAY_HTTP_TIMEOUT);
    stream
        .set_read_timeout(timeout)
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    stream
        .set_write_timeout(timeout)
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    let request = build_http_request(port, method, path, access_token, body)?;
    stream
        .write_all(request.as_bytes())
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| GatewayError::Io(err.to_string()))?;
    parse_http_response(&response)
}

#[cfg(test)]
fn build_get_request(port: u16, path: &str, access_token: Option<&str>) -> String {
    build_http_request(port, "GET", path, access_token, None)
        .expect("fixed internal GET request must be valid")
}

fn build_http_request(
    port: u16,
    method: &str,
    path: &str,
    access_token: Option<&str>,
    body: Option<&str>,
) -> Result<String, GatewayError> {
    if !matches!(method, "GET" | "POST") {
        return Err(GatewayError::Config(
            "Unsupported local HTTP method.".into(),
        ));
    }
    if !path.starts_with('/') || path.contains('\r') || path.contains('\n') {
        return Err(GatewayError::Config("Invalid local gateway path.".into()));
    }
    if access_token.is_some_and(|token| !is_valid_access_token(token)) {
        return Err(GatewayError::Config(
            "The local pairing key is invalid; rotate it in the desktop app.".into(),
        ));
    }
    let authorization = access_token
        .map(|token| format!("Authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    let body = body.unwrap_or_default();
    let content_headers = if method == "POST" {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        )
    } else {
        String::new()
    };
    Ok(format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{authorization}{content_headers}Connection: close\r\n\r\n{body}"
    ))
}

fn parse_http_response(response: &str) -> Result<LocalHttpResponse, GatewayError> {
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| GatewayError::Io("Gateway returned an invalid HTTP response.".into()))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| GatewayError::Io("Gateway returned an invalid HTTP status.".into()))?;
    Ok(LocalHttpResponse {
        status,
        body: body.trim().to_string(),
    })
}

fn gateway_health(port: u16) -> Result<LocalHttpResponse, GatewayError> {
    let response = http_get_localhost(port, "/health", None)?;
    validate_gateway_health(&response)?;
    Ok(response)
}

fn parse_gateway_json(
    response: LocalHttpResponse,
    operation: &str,
) -> Result<serde_json::Value, GatewayError> {
    if !(200..300).contains(&response.status) {
        let detail = serde_json::from_str::<serde_json::Value>(&response.body)
            .ok()
            .and_then(|payload| {
                payload
                    .pointer("/error/message")
                    .or_else(|| payload.get("detail"))
                    .and_then(|value| value.as_str())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| format!("HTTP {}", response.status));
        return Err(GatewayError::Io(format!(
            "Gateway {operation} failed: {detail}"
        )));
    }
    serde_json::from_str(&response.body).map_err(|error| {
        GatewayError::Io(format!(
            "Gateway {operation} returned invalid JSON: {error}"
        ))
    })
}

fn validate_gateway_identity_payload(payload: &serde_json::Value) -> Result<(), GatewayError> {
    if payload.get("service").and_then(|value| value.as_str()) != Some(GATEWAY_SERVICE_ID)
        || payload
            .get("protocol_version")
            .and_then(|value| value.as_str())
            != Some(GATEWAY_PROTOCOL_VERSION)
    {
        return Err(GatewayError::Io(
            "The listener on this port is not the Therapy Local Runtime.".into(),
        ));
    }
    Ok(())
}

fn validate_gateway_health(response: &LocalHttpResponse) -> Result<(), GatewayError> {
    if response.status != 200 {
        return Err(GatewayError::Io(format!(
            "Gateway health returned HTTP {}.",
            response.status
        )));
    }
    let payload: serde_json::Value = serde_json::from_str(&response.body)
        .map_err(|_| GatewayError::Io("Gateway health returned invalid JSON.".into()))?;
    validate_gateway_identity_payload(&payload)
}

fn validate_model_ids(models: Vec<String>) -> Result<Vec<String>, GatewayError> {
    let mut validated = Vec::new();
    for model_id in models {
        if model_id.is_empty()
            || model_id.len() > 160
            || !model_id.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-' | b':')
            })
        {
            return Err(GatewayError::Config("Invalid model identifier.".into()));
        }
        if !validated.contains(&model_id) {
            validated.push(model_id);
        }
    }
    if validated.is_empty() {
        return Err(GatewayError::Config(
            "Select at least one model before loading.".into(),
        ));
    }
    if validated.len() > 8 {
        return Err(GatewayError::Config(
            "No more than eight models can be loaded in one job.".into(),
        ));
    }
    Ok(validated)
}

fn validate_load_job_id(job_id: &str) -> Result<(), GatewayError> {
    let suffix = job_id.strip_prefix("load_").unwrap_or_default();
    if suffix.len() != 32 || !suffix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GatewayError::Config(
            "Invalid model-load job identifier.".into(),
        ));
    }
    Ok(())
}

impl GatewayManager {
    fn start(&self, app: &tauri::AppHandle) -> Result<StatusResponse, GatewayError> {
        let config = build_launch_config(app)?;
        let mut guard = self.inner.lock().expect("state lock");
        Self::refresh_child_state(&mut guard);
        if guard.child.is_some() {
            drop(guard);
            return Ok(self.status_with_health(config.port));
        }

        let port_in_use = TcpListener::bind(("127.0.0.1", config.port)).is_err();
        if port_in_use {
            match gateway_health(config.port) {
                Ok(health) => {
                    self.push_log(format!(
                        "Gateway already running on port {} (health: {})",
                        config.port, health.body
                    ));
                    return Ok(StatusResponse {
                        status: "running".into(),
                    });
                }
                Err(error) => {
                    self.push_notice(format!(
                        "Port {} is in use but health check failed: {:?}",
                        config.port, error
                    ));
                    return Err(GatewayError::Config(format!(
                        "Port {} is in use and the gateway is not responding.",
                        config.port
                    )));
                }
            }
        }

        match config.mode {
            GatewayLaunchMode::Python => {
                run_python_import_check(&config)?;
                let python_path = config.python_path.as_ref().ok_or_else(|| {
                    GatewayError::Config("Missing python path for python launch".into())
                })?;
                let gateway_root = config.gateway_root.as_ref().ok_or_else(|| {
                    GatewayError::Config("Missing gateway root for python launch".into())
                })?;
                let mut command = Command::new(python_path);
                command
                    .args(&config.args)
                    .current_dir(gateway_root)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                apply_python_env(&mut command, &config)?;

                let mut child = command.spawn().map_err(|err| {
                    GatewayError::SpawnFailed(Box::new(GatewayErrorDetails {
                        message: err.to_string(),
                        launcher: python_path.to_string(),
                        gateway_root: Some(gateway_root.to_string_lossy().to_string()),
                        config_path: config.config_path.to_string_lossy().to_string(),
                        args: config.args.clone(),
                        hint: Some(
                            "local_runtime not found; check resources or set LOCAL_RUNTIME_ROOT."
                                .to_string(),
                        ),
                    }))
                })?;

                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                guard.child_generation = guard.child_generation.wrapping_add(1);
                guard.child_port = Some(config.port);
                guard.child = Some(GatewayChild::Python(child));
                drop(guard);

                self.push_log("Gateway started (python)");

                if let Some(stream) = stdout {
                    let manager = self.clone();
                    std::thread::spawn(move || {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stream);
                        for line in reader.lines().map_while(Result::ok) {
                            manager.push_log(line);
                        }
                    });
                }

                if let Some(stream) = stderr {
                    let manager = self.clone();
                    std::thread::spawn(move || {
                        use std::io::{BufRead, BufReader};
                        let reader = BufReader::new(stream);
                        for line in reader.lines().map_while(Result::ok) {
                            manager.push_log(line);
                        }
                    });
                }
            }
            GatewayLaunchMode::Sidecar => {
                let packaged_runtime_root = app
                    .path()
                    .resource_dir()
                    .map_err(|err| {
                        GatewayError::Config(format!(
                            "Unable to resolve packaged resource directory: {err}"
                        ))
                    })?
                    .join("local-runtime-python");
                let command = resolve_sidecar_command(app)?
                    .env("LOCAL_RUNTIME_PACKAGED_ROOT", packaged_runtime_root)
                    .args(&config.args);
                let (mut rx, child) = command.spawn().map_err(|err| {
                    GatewayError::SpawnFailed(Box::new(GatewayErrorDetails {
                        message: err.to_string(),
                        launcher: "sidecar:local-runtime-gateway".into(),
                        gateway_root: None,
                        config_path: config.config_path.to_string_lossy().to_string(),
                        args: config.args.clone(),
                        hint: Some(
                            "Sidecar not resolvable. Ensure tauri.sidecar.conf.json is used (see `npm run tauri:dev`) or run `npm run sidecar:build`."
                                .to_string(),
                        ),
                    }))
                })?;

                let sidecar_pid = child.pid();
                guard.child_generation = guard.child_generation.wrapping_add(1);
                let generation = guard.child_generation;
                guard.child_port = Some(config.port);
                guard.child = Some(GatewayChild::Sidecar(child));
                drop(guard);

                self.push_log("Gateway started (sidecar)");

                let manager = self.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                manager.push_log(String::from_utf8_lossy(&line).trim().to_string())
                            }
                            CommandEvent::Stderr(line) => {
                                manager.push_log(String::from_utf8_lossy(&line).trim().to_string())
                            }
                            CommandEvent::Error(line) => {
                                manager.push_notice(format!("sidecar error: {line}"));
                            }
                            CommandEvent::Terminated(payload) => {
                                manager.push_notice(format!(
                                    "Gateway sidecar PID {} exited with code {:?}",
                                    sidecar_pid, payload.code
                                ));
                                manager.clear_child_if_generation(generation);
                            }
                            _ => {}
                        }
                    }
                });
            }
        }

        Ok(StatusResponse {
            status: "starting".into(),
        })
    }
}

fn resolve_sidecar_command(
    app: &tauri::AppHandle,
) -> Result<tauri_plugin_shell::process::Command, GatewayError> {
    app.shell()
        .sidecar("local-runtime-gateway")
        .map_err(|err| GatewayError::Config(format!("Sidecar unavailable: {err}")))
}

fn resolve_sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let target = target_triple();
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let dev_filename = format!("local-runtime-gateway-{target}{exe_suffix}");
    let runtime_filename = format!("local-runtime-gateway{exe_suffix}");

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            let candidate = ancestor
                .join("services")
                .join("local-runtime-suite")
                .join("desktop")
                .join("src-tauri")
                .join("binaries")
                .join(&dev_filename);
            if candidate.exists() {
                return Some(candidate);
            }

            let direct_candidate = ancestor
                .join("src-tauri")
                .join("binaries")
                .join(&dev_filename);
            if direct_candidate.exists() {
                return Some(direct_candidate);
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let candidate = parent.join(&runtime_filename);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(&runtime_filename);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    // Windows doesn't have Unix exec bits; this is a simple existence check.
    // If you want stricter behavior, check extensions at the call-site.
    path.exists()
}

#[cfg(not(any(unix, windows)))]
fn is_executable(path: &Path) -> bool {
    path.exists()
}

fn target_triple() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-pc-windows-msvc"
        } else {
            "x86_64-pc-windows-msvc"
        }
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(GatewayManager::new())
        .invoke_handler(tauri::generate_handler![
            start_gateway,
            stop_gateway,
            gateway_status,
            gateway_logs,
            gateway_doctor,
            gateway_models,
            gateway_runtime_state,
            gateway_load_models,
            gateway_model_load_status,
            save_gateway_config,
            gateway_config,
            gateway_connection_info,
            gateway_storage_paths,
            gateway_pairing_token,
            rotate_gateway_pairing_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_http_status_and_body() {
        let response = parse_http_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ready\"}",
        )
        .expect("valid response");

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"status\":\"ready\"}");
    }

    #[test]
    fn authenticated_request_places_token_in_header_only() {
        let token = "a".repeat(64);
        let request = build_get_request(8484, "/v1/models", Some(&token));

        assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
        assert!(request.contains(&format!("Authorization: Bearer {token}\r\n")));
        assert!(!request.lines().next().unwrap_or_default().contains(&token));
    }

    #[test]
    fn post_request_has_json_body_and_exact_length() {
        let token = "b".repeat(64);
        let body = r#"{"models":["local//llm/qwen3-hf"]}"#;
        let request = build_http_request(8484, "POST", "/load_models", Some(&token), Some(body))
            .expect("valid POST request");

        assert!(request.starts_with("POST /load_models HTTP/1.1\r\n"));
        assert!(request.contains("Content-Type: application/json\r\n"));
        assert!(request.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(request.ends_with(body));
    }

    #[test]
    fn request_builder_rejects_header_injection() {
        let invalid_token = format!("{}\r\nInjected: yes", "a".repeat(32));
        assert!(build_http_request(8484, "GET", "/v1/models", Some(&invalid_token), None).is_err());
        assert!(
            build_http_request(8484, "GET", "/v1/models\r\nInjected: yes", None, None).is_err()
        );
    }

    #[test]
    fn validates_model_and_load_job_identifiers() {
        assert_eq!(
            validate_model_ids(vec![
                "local//llm/qwen3-hf".into(),
                "local//llm/qwen3-hf".into()
            ])
            .expect("valid model ids"),
            vec!["local//llm/qwen3-hf"]
        );
        assert!(validate_model_ids(vec!["local model\r\n".into()]).is_err());
        assert!(validate_load_job_id(&format!("load_{}", "f".repeat(32))).is_ok());
        assert!(validate_load_job_id("load_not-hex").is_err());
    }

    #[test]
    fn health_requires_therapy_gateway_identity() {
        let valid = LocalHttpResponse {
            status: 200,
            body: serde_json::json!({
                "service": GATEWAY_SERVICE_ID,
                "protocol_version": GATEWAY_PROTOCOL_VERSION,
                "status": "ready"
            })
            .to_string(),
        };
        assert!(validate_gateway_health(&valid).is_ok());

        let unrelated = LocalHttpResponse {
            status: 200,
            body: r#"{"service":"unrelated-server","status":"ready"}"#.to_string(),
        };
        assert!(validate_gateway_health(&unrelated).is_err());
    }

    #[test]
    fn config_write_is_private_and_preserves_token() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let config_path = directory.path().join("nested").join("config.json");
        let token = generate_access_token().expect("secure token");

        write_gateway_config(
            &config_path,
            8484,
            &HashMap::new(),
            "/private/runtime-data",
            "/private/model-cache",
            true,
            &token,
        )
        .expect("write config");

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&config_path).expect("read config"))
                .expect("parse config");
        assert_eq!(value["access_token"], token);
        assert_eq!(value["data_dir"], "/private/runtime-data");
        assert_eq!(value["cache_dir"], "/private/model-cache");
        #[cfg(unix)]
        assert_eq!(
            std::fs::metadata(&config_path)
                .expect("config metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn storage_paths_report_the_authoritative_configured_locations() {
        let config_path = PathBuf::from("/tmp/therapy/local-runtime/config.json");
        let config = GatewayConfigResponse {
            port: 8484,
            default_models: HashMap::new(),
            data_dir: "/custom/private-data".into(),
            cache_dir: "/custom/model-cache".into(),
            prefer_local: true,
            access_token: "a".repeat(64),
        };
        let paths = storage_paths_from_config(&config_path, &config);

        assert_eq!(paths.config_file, "/tmp/therapy/local-runtime/config.json");
        assert_eq!(paths.data_dir, "/custom/private-data");
        assert_eq!(paths.cache_dir, "/custom/model-cache");
        assert_eq!(paths.logging_policy, "metadata_only");
    }

    #[test]
    fn relative_storage_paths_resolve_against_the_config_directory() {
        let config_parent = PathBuf::from("/tmp/therapy/local-runtime");

        let (data_dir, data_changed) =
            resolve_configured_directory(&config_parent, Some("private-data".into()), "data");
        let (cache_dir, cache_changed) =
            resolve_configured_directory(&config_parent, Some("model-cache".into()), "cache");
        let (absolute_dir, absolute_changed) = resolve_configured_directory(
            &config_parent,
            Some("/custom/absolute-cache".into()),
            "cache",
        );

        assert_eq!(data_dir, "/tmp/therapy/local-runtime/private-data");
        assert_eq!(cache_dir, "/tmp/therapy/local-runtime/model-cache");
        assert!(data_changed);
        assert!(cache_changed);
        assert_eq!(absolute_dir, "/custom/absolute-cache");
        assert!(!absolute_changed);
    }

    #[test]
    fn pairing_rotation_restores_the_previous_key_when_restart_fails() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let config_path = directory.path().join("config.json");
        let current = GatewayConfigResponse {
            port: 8484,
            default_models: HashMap::new(),
            data_dir: directory.path().join("data").to_string_lossy().into_owned(),
            cache_dir: directory
                .path()
                .join("cache")
                .to_string_lossy()
                .into_owned(),
            prefer_local: true,
            access_token: "a".repeat(64),
        };
        write_gateway_config(
            &config_path,
            current.port,
            &current.default_models,
            &current.data_dir,
            &current.cache_dir,
            current.prefer_local,
            &current.access_token,
        )
        .expect("write initial config");
        let mut stop_calls = 0;
        let mut start_calls = 0;

        let error = rotate_pairing_token_transaction(
            &config_path,
            &current,
            "b".repeat(64),
            true,
            || {
                stop_calls += 1;
                Ok(())
            },
            || {
                start_calls += 1;
                if start_calls == 1 {
                    Err(GatewayError::Io("simulated restart failure".into()))
                } else {
                    Ok(())
                }
            },
        )
        .expect_err("failed restart must fail the rotation");

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&config_path).expect("read restored config"))
                .expect("parse restored config");
        assert_eq!(value["access_token"], current.access_token);
        assert_eq!(stop_calls, 2);
        assert_eq!(start_calls, 2);
        match error {
            GatewayError::Config(message) => {
                assert!(message.contains("previous key was restored"));
            }
            other => panic!("unexpected gateway error: {other:?}"),
        }
    }

    #[test]
    fn pairing_rotation_returns_new_key_only_after_a_successful_restart() {
        let directory = tempfile::tempdir().expect("temporary config directory");
        let config_path = directory.path().join("config.json");
        let current = GatewayConfigResponse {
            port: 8484,
            default_models: HashMap::new(),
            data_dir: directory.path().join("data").to_string_lossy().into_owned(),
            cache_dir: directory
                .path()
                .join("cache")
                .to_string_lossy()
                .into_owned(),
            prefer_local: true,
            access_token: "a".repeat(64),
        };
        let new_token = "b".repeat(64);
        let mut stopped = false;
        let mut started = false;

        let response = rotate_pairing_token_transaction(
            &config_path,
            &current,
            new_token.clone(),
            true,
            || {
                stopped = true;
                Ok(())
            },
            || {
                started = true;
                Ok(())
            },
        )
        .expect("successful rotation");

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&config_path).expect("read rotated config"))
                .expect("parse rotated config");
        assert!(stopped);
        assert!(started);
        assert_eq!(response.token, new_token);
        assert_eq!(value["access_token"], new_token);
    }

    #[test]
    fn stop_reports_stopped_without_an_owned_process_or_listener() {
        let manager = GatewayManager::new();
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("reserve test port");
        let port = listener.local_addr().expect("listener address").port();
        drop(listener);

        let response = manager.stop(Some(port)).expect("nothing to stop");

        assert_eq!(response.status, "stopped");
    }

    #[test]
    fn stop_refuses_to_claim_an_unowned_listener_was_stopped() {
        let manager = GatewayManager::new();
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener");
        let port = listener.local_addr().expect("listener address").port();

        let error = manager
            .stop(Some(port))
            .expect_err("unowned listener must not be reported as stopped");

        match error {
            GatewayError::Config(message) => {
                assert!(message.contains("not owned by this desktop app"));
            }
            other => panic!("unexpected gateway error: {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn stop_terminates_and_reaps_an_owned_python_child() {
        let manager = GatewayManager::new();
        let child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("spawn test child");
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("reserve test port");
        let port = listener.local_addr().expect("listener address").port();
        drop(listener);
        {
            let mut guard = manager.inner.lock().expect("state lock");
            guard.child = Some(GatewayChild::Python(child));
            guard.child_port = Some(port);
            guard.child_generation = 1;
        }

        let response = manager.stop(None).expect("stop owned child");

        assert_eq!(response.status, "stopped");
        assert!(manager.inner.lock().expect("state lock").child.is_none());
    }

    #[test]
    fn stale_termination_event_cannot_clear_newer_gateway_state() {
        let manager = GatewayManager::new();
        {
            let mut guard = manager.inner.lock().expect("state lock");
            guard.child_generation = 2;
            guard.child_port = Some(8485);
            guard.orphaned_sidecar = Some((123, 8485));
        }

        manager.clear_child_if_generation(1);

        let guard = manager.inner.lock().expect("state lock");
        assert_eq!(guard.child_port, Some(8485));
        assert_eq!(guard.orphaned_sidecar, Some((123, 8485)));
    }
}
