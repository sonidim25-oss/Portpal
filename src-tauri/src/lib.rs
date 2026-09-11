mod connections;
mod logger;
mod netaddr;
mod scanner;
mod taxonomy;
mod tray;

use std::collections::HashMap;

/// Runs blocking work on the async runtime's blocking pool.
///
/// `Err` is returned only when the worker itself could not complete (the pool
/// rejected the job or the closure panicked), which is distinct from the work
/// returning its own error.
async fn run_off_thread<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("background worker failed: {e}"))
}

// Every command below runs its work through `spawn_blocking` on an `async fn`.
// A plain sync command body is invoked inline on the thread that dispatches
// IPC, so a scan or a kill would stall the webview and queue every other
// command behind it. `async fn` hands the work to the async runtime, and
// `spawn_blocking` keeps genuinely blocking calls off the runtime's worker
// threads so concurrent lifecycle operations cannot starve it.

#[tauri::command]
async fn get_ports() -> Result<Vec<scanner::PortInfo>, scanner::ScanError> {
    run_off_thread(scanner::try_scan_ports)
        .await
        .unwrap_or_else(|e| Err(scanner::ScanError::worker_failed(e)))
}

#[tauri::command]
async fn kill_process(pid: u32) -> Result<(), scanner::KillError> {
    run_off_thread(move || scanner::kill_pid(pid))
        .await
        .unwrap_or_else(|e| Err(scanner::KillError::new("worker_failed", e)))
}

/// Restarts a scanned process. Takes only a port and a pid: the command line
/// and working directory come from the backend's trusted store, never from the
/// webview.
#[tauri::command]
async fn restart_process(port: u16, pid: u32) -> Result<(), String> {
    run_off_thread(move || scanner::restart_trusted(port, pid))
        .await
        .unwrap_or_else(Err)
}

#[tauri::command]
fn get_port_events() -> Vec<logger::PortEvent> {
    let lg = logger::LOGGER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    lg.get_events()
}

#[tauri::command]
fn get_port_traffic() -> HashMap<u16, Vec<logger::TrafficSample>> {
    let lg = logger::LOGGER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    lg.get_all_traffic()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_ports,
            kill_process,
            restart_process,
            get_port_events,
            get_port_traffic
        ])
        .setup(|app| {
            // Preflight: confirm every external tool this platform needs
            // actually works before the UI reports empty data. Both capabilities
            // are checked, because they are not always the same binary: Linux
            // lists listeners with `lsof` and reads connections with `ss`, so
            // checking only the scanner's tool let a missing `ss` start up clean
            // and then report an edgeless port map with every connection count
            // at 0 — the same picture as an idle machine. A failure is logged
            // and the app still starts; the scan error also reaches the user
            // through get_ports and the tray's scan-degraded event.
            if let Err(e) = scanner::preflight() {
                eprintln!(
                    "PortPal preflight failed [{}]: {} (port scanning will be unavailable until `{}` works)",
                    e.code, e.message, e.tool
                );
            }
            if let Err(e) = connections::preflight() {
                eprintln!(
                    "PortPal preflight failed [{}]: {} (connection counts and the port map will read as empty until `{}` works)",
                    e.code, e.message, e.tool
                );
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
