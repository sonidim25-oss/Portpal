#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod scanner;
mod tray;
mod connections;
mod logger;

use std::collections::HashMap;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_ports,
            kill_process,
            restart_process,
            get_port_graph,
            get_port_events,
            get_port_traffic,
        ])
        .setup(|app| {
            // Preflight: confirm the platform's port-listing tool actually
            // works before the UI reports an empty list. A failure is logged
            // and the app still starts — the scan error reaches the user
            // through get_ports and the tray's scan-degraded event.
            if let Err(e) = scanner::preflight() {
                eprintln!(
                    "PortPal preflight failed [{}]: {} (port scanning will be unavailable until `{}` works)",
                    e.code, e.message, e.tool
                );
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray instead of closing
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_ports() -> Result<Vec<scanner::PortInfo>, scanner::ScanError> {
    scanner::try_scan_ports()
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<(), scanner::KillError> {
    scanner::kill_pid(pid)
}

/// Restarts a scanned process. Takes only a port and a pid: the command line
/// and working directory come from the backend's trusted store, never from the
/// webview. Kept identical to the `lib.rs` command.
#[tauri::command]
fn restart_process(port: u16, pid: u32) -> Result<(), String> {
    scanner::restart_trusted(port, pid)
}

#[tauri::command]
fn get_port_graph() -> Result<connections::PortGraph, scanner::ScanError> {
    let ports = scanner::try_scan_ports()?;
    let listening: Vec<(u16, u32, String, Option<String>)> = ports
        .iter()
        .map(|p| (p.port, p.pid, p.process_name.clone(), p.project_name.clone()))
        .collect();
    Ok(connections::get_port_graph(&listening))
}

#[tauri::command]
fn get_port_events() -> Vec<logger::PortEvent> {
    let lg = logger::LOGGER.lock().unwrap();
    lg.get_events()
}

#[tauri::command]
fn get_port_traffic() -> HashMap<u16, Vec<logger::TrafficSample>> {
    let lg = logger::LOGGER.lock().unwrap();
    lg.get_all_traffic()
}
