mod scanner;
mod tray;
mod connections;
mod logger;

use tauri::Manager;
use std::collections::HashMap;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_ports() -> Vec<scanner::PortInfo> {
    scanner::scan_ports()
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    scanner::kill_pid(pid)
}

/// Restarts a scanned process. Takes only a port and a pid: the command line
/// and working directory come from the backend's trusted store, never from the
/// webview.
#[tauri::command]
fn restart_process(port: u16, pid: u32) -> Result<(), String> {
    scanner::restart_trusted(port, pid)
}

#[tauri::command]
fn get_port_graph() -> connections::PortGraph {
    let ports = scanner::scan_ports();
    let listening: Vec<(u16, u32, String, Option<String>)> = ports
        .iter()
        .map(|p| (p.port, p.pid, p.process_name.clone(), p.project_name.clone()))
        .collect();
    connections::get_port_graph(&listening)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_ports,
            kill_process,
            restart_process,
            get_port_graph,
            get_port_events,
            get_port_traffic
        ])
        .setup(|app| {
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
