use std::{
    env, fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Emitter, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const DEFAULT_PORT: u16 = 8765;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum BackendState {
    Starting,
    Ready,
    External,
    Failed,
    Stopped,
}

#[derive(Clone, Debug, Serialize)]
struct BackendSupervisorStatus {
    state: BackendState,
    message: String,
    port: u16,
    managed: bool,
}

#[derive(Clone)]
struct BackendSupervisor {
    status: Arc<Mutex<BackendSupervisorStatus>>,
    child: Arc<Mutex<Option<CommandChild>>>,
    child_pid: Arc<Mutex<Option<u32>>>,
}

impl BackendSupervisor {
    fn new(port: u16) -> Self {
        Self {
            status: Arc::new(Mutex::new(BackendSupervisorStatus {
                state: BackendState::Starting,
                message: format!("Starting the StagePilot backend on port {port}."),
                port,
                managed: true,
            })),
            child: Arc::new(Mutex::new(None)),
            child_pid: Arc::new(Mutex::new(None)),
        }
    }

    fn snapshot(&self) -> BackendSupervisorStatus {
        self.status
            .lock()
            .expect("backend status lock poisoned")
            .clone()
    }

    fn update(
        &self,
        app: &tauri::AppHandle,
        state: BackendState,
        message: impl Into<String>,
        managed: bool,
    ) {
        let mut status = self.status.lock().expect("backend status lock poisoned");
        status.state = state;
        status.message = message.into();
        status.managed = managed;
        let snapshot = status.clone();
        drop(status);
        let _ = app.emit("stagepilot://backend-status", snapshot);
    }

    fn stop(&self, app: &tauri::AppHandle) {
        self.update(
            app,
            BackendState::Stopped,
            "StagePilot backend stopped.",
            true,
        );
        let pid = self
            .child_pid
            .lock()
            .expect("backend child PID lock poisoned")
            .take();
        #[cfg(target_os = "windows")]
        if let Some(pid) = pid {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = std::process::Command::new("taskkill.exe")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        #[cfg(not(target_os = "windows"))]
        let _ = pid;
        if let Some(child) = self
            .child
            .lock()
            .expect("backend child lock poisoned")
            .take()
        {
            let _ = child.kill();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum PortProbe {
    Available,
    StagePilot,
    Occupied,
}

fn settings_path() -> PathBuf {
    if let Some(path) = env::var_os("STAGEPILOT_SETTINGS_PATH") {
        return PathBuf::from(path);
    }
    #[cfg(target_os = "windows")]
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("USERPROFILE").unwrap_or_default())
                .join("AppData")
                .join("Roaming")
        });
    #[cfg(not(target_os = "windows"))]
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env::var_os("HOME").unwrap_or_default()).join(".config"));
    base.join("StagePilot").join("settings.json")
}

fn configured_port() -> u16 {
    if let Ok(value) = env::var("STAGEPILOT_PORT") {
        if let Ok(port) = value.parse::<u16>() {
            if port > 0 {
                return port;
            }
        }
    }
    fs::read_to_string(settings_path())
        .ok()
        .as_deref()
        .and_then(port_from_settings)
        .unwrap_or(DEFAULT_PORT)
}

fn port_from_settings(contents: &str) -> Option<u16> {
    serde_json::from_str::<serde_json::Value>(contents)
        .ok()
        .and_then(|settings| settings.get("server_port")?.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
}

fn probe_port(port: u16) -> PortProbe {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return PortProbe::Available;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return PortProbe::Occupied;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_ok()
        && response.starts_with("HTTP/1.1 200")
        && response.contains("\"application_status\"")
        && response.contains("\"version\"")
    {
        PortProbe::StagePilot
    } else {
        PortProbe::Occupied
    }
}

fn wait_for_backend(app: tauri::AppHandle, supervisor: BackendSupervisor, port: u16) {
    std::thread::spawn(move || {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        while Instant::now() < deadline {
            match probe_port(port) {
                PortProbe::StagePilot => {
                    supervisor.update(
                        &app,
                        BackendState::Ready,
                        format!("StagePilot backend is ready on port {port}."),
                        true,
                    );
                    return;
                }
                PortProbe::Available | PortProbe::Occupied => {
                    std::thread::sleep(PROBE_INTERVAL);
                }
            }
        }
        supervisor.update(
            &app,
            BackendState::Failed,
            format!("The StagePilot backend did not become ready on port {port}."),
            true,
        );
    });
}

fn start_backend(app: &tauri::AppHandle, supervisor: BackendSupervisor) -> Result<(), String> {
    let port = supervisor.snapshot().port;
    match probe_port(port) {
        PortProbe::StagePilot => {
            supervisor.update(
                app,
                BackendState::External,
                format!("Connected to an existing StagePilot backend on port {port}."),
                false,
            );
            return Ok(());
        }
        PortProbe::Occupied => {
            supervisor.update(
                app,
                BackendState::Failed,
                format!("Port {port} is already in use by another application."),
                false,
            );
            return Ok(());
        }
        PortProbe::Available => {}
    }

    let command = app
        .shell()
        .sidecar("stagepilot-backend")
        .map_err(|error| format!("Unable to locate the packaged backend: {error}"))?
        .env("STAGEPILOT_HOST", "127.0.0.1")
        .env("STAGEPILOT_PORT", port.to_string())
        .env("STAGEPILOT_SETTINGS_PATH", settings_path());
    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Unable to start the packaged backend: {error}"))?;
    *supervisor
        .child_pid
        .lock()
        .expect("backend child PID lock poisoned") = Some(child.pid());
    *supervisor
        .child
        .lock()
        .expect("backend child lock poisoned") = Some(child);

    let event_app = app.clone();
    let event_supervisor = supervisor.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                if !matches!(event_supervisor.snapshot().state, BackendState::Stopped) {
                    event_supervisor.update(
                        &event_app,
                        BackendState::Failed,
                        format!(
                            "The StagePilot backend exited unexpectedly (code {:?}).",
                            payload.code
                        ),
                        true,
                    );
                }
                break;
            }
        }
    });
    wait_for_backend(app.clone(), supervisor, port);
    Ok(())
}

#[tauri::command]
fn backend_supervisor_status(
    supervisor: tauri::State<'_, BackendSupervisor>,
) -> BackendSupervisorStatus {
    supervisor.snapshot()
}

#[tauri::command]
async fn restart_managed_backend(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, BackendSupervisor>,
) -> Result<BackendSupervisorStatus, String> {
    if !supervisor.snapshot().managed {
        return Err(
            "StagePilot is connected to an older external backend. Fully quit StagePilot once, then reopen it."
                .to_string(),
        );
    }
    supervisor.update(
        &app,
        BackendState::Stopped,
        "Restarting the StagePilot backend.",
        true,
    );
    supervisor
        .child_pid
        .lock()
        .expect("backend child PID lock poisoned")
        .take();
    if let Some(child) = supervisor
        .child
        .lock()
        .expect("backend child lock poisoned")
        .take()
    {
        child
            .kill()
            .map_err(|error| format!("Could not stop the current StagePilot backend: {error}"))?;
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline
        && probe_port(supervisor.snapshot().port) != PortProbe::Available
    {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if probe_port(supervisor.snapshot().port) != PortProbe::Available {
        return Err("The previous StagePilot backend did not stop in time.".to_string());
    }

    supervisor.update(
        &app,
        BackendState::Starting,
        format!(
            "Starting the StagePilot backend on port {}.",
            supervisor.snapshot().port
        ),
        true,
    );
    start_backend(&app, supervisor.inner().clone())?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if probe_port(supervisor.snapshot().port) == PortProbe::StagePilot {
            return Ok(supervisor.snapshot());
        }
        tokio::time::sleep(PROBE_INTERVAL).await;
    }
    Err("The restarted StagePilot backend did not become ready.".to_string())
}

#[tauri::command]
fn quit_application(app: tauri::AppHandle) {
    app.exit(0);
}

/// Starts the StagePilot native shell and supervises its packaged backend.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = configured_port();
    let supervisor = BackendSupervisor::new(port);
    let shutdown_supervisor = supervisor.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(supervisor.clone())
        .invoke_handler(tauri::generate_handler![
            backend_supervisor_status,
            restart_managed_backend,
            quit_application
        ])
        .setup(move |app| {
            if let Err(message) = start_backend(app.handle(), supervisor.clone()) {
                supervisor.update(app.handle(), BackendState::Failed, message, true);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the StagePilot desktop shell");

    app.run(move |handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            shutdown_supervisor.stop(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_server_port_is_validated() {
        assert_eq!(port_from_settings(r#"{"server_port": 9123}"#), Some(9123));
        assert_eq!(port_from_settings(r#"{"server_port": 0}"#), None);
        assert_eq!(port_from_settings(r#"{"server_port": 70000}"#), None);
        assert_eq!(port_from_settings("not-json"), None);
    }

    #[test]
    fn unused_local_port_is_available() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(probe_port(port), PortProbe::Available);
    }

    #[test]
    fn stagepilot_health_response_is_identified() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request);
            let body = r#"{"version":"0.1.0","application_status":"running"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        assert_eq!(probe_port(port), PortProbe::StagePilot);
        server.join().unwrap();
    }

    #[test]
    fn unrelated_listener_is_reported_as_occupied() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                .unwrap();
        });
        assert_eq!(probe_port(port), PortProbe::Occupied);
        server.join().unwrap();
    }
}
