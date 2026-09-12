use crate::scanner::{self, PortInfo};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, PartialEq, Debug, Serialize)]
pub enum TrafficState {
    Clear,
    Active,
    Conflict,
}

struct DebounceState {
    pending: TrafficState,
    since: Instant,
    current: TrafficState,
}

impl DebounceState {
    fn new() -> Self {
        Self {
            pending: TrafficState::Clear,
            since: Instant::now(),
            current: TrafficState::Clear,
        }
    }
}

/// Tray liveness derives from the shared taxonomy table
/// (`taxonomy::is_dev_port`), so icon state, tooltip count, and graph
/// liveness can never diverge into per-surface port lists.
fn is_tray_dev_port(port: u16) -> bool {
    crate::taxonomy::is_dev_port(port)
}

/// Poison-tolerant mutex access: a panic while holding the lock must degrade
/// to the last good state, never wedge the watcher into permanent panics.
fn lock_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| {
        eprintln!("PortPal: recovered poisoned mutex; continuing with last good state");
        poisoned.into_inner()
    })
}

fn compute_state(ports: &[PortInfo]) -> TrafficState {
    // Multiple PIDs are normal for SO_REUSEPORT and master/worker servers.
    // Only different process identities indicate a real conflict.
    let mut seen: std::collections::HashMap<u16, (&str, Option<&str>)> =
        std::collections::HashMap::new();
    for p in ports {
        if let Some((process_name, project_path)) = seen.get(&p.port) {
            if *process_name != p.process_name.as_str()
                || *project_path != p.project_path.as_deref()
            {
                return TrafficState::Conflict;
            }
        } else {
            seen.insert(p.port, (&p.process_name, p.project_path.as_deref()));
        }
    }

    // Active: any known dev port is in use
    if ports.iter().any(|p| is_tray_dev_port(p.port)) {
        return TrafficState::Active;
    }

    TrafficState::Clear
}

fn get_icon_bytes(state: &TrafficState) -> &'static [u8] {
    match state {
        TrafficState::Clear => include_bytes!("../icons/tray-green.png"),
        TrafficState::Active => include_bytes!("../icons/tray-yellow.png"),
        TrafficState::Conflict => include_bytes!("../icons/tray-red.png"),
    }
}

fn get_tooltip(state: &TrafficState, port_count: usize) -> String {
    match state {
        TrafficState::Clear => "PortPal — All clear".into(),
        TrafficState::Active => format!(
            "PortPal — {} dev port{} active",
            port_count,
            if port_count == 1 { "" } else { "s" }
        ),
        TrafficState::Conflict => "PortPal — ⚠ Port conflict detected!".into(),
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    // Build right-click menu
    let open = MenuItemBuilder::new("Open PortPal").id("open").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&separator)
        .item(&quit)
        .build()?;

    // Build initial tray with green icon
    let _tray = TrayIconBuilder::new()
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray-green.png"
        ))?)
        .tooltip("PortPal — Starting…")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click = open window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Start background watcher thread
    let app_handle = app.clone();
    let debounce = Arc::new(Mutex::new(DebounceState::new()));
    let last_ports_json = Arc::new(Mutex::new(String::new()));

    // Tracks whether the previous tick's scan failed, so a persistent outage
    // is reported once rather than every two seconds forever.
    let mut degraded = false;

    std::thread::spawn(move || {
        loop {
            // Keep the tray responsive while the window is open, but avoid
            // repeatedly spawning the platform scan tools while the app is
            // hidden. A later foreground interaction triggers a fresh scan.
            let poll_interval = app_handle
                .get_webview_window("main")
                .and_then(|window| window.is_visible().ok())
                .map(|visible| if visible { 2 } else { 10 })
                .unwrap_or(2);
            std::thread::sleep(Duration::from_secs(poll_interval));

            // Reap any child processes spawned by restart that have exited,
            // so they don't linger as zombies (Unix) or leak handles (Windows).
            scanner::reap_children();

            // A failed scan must not be flattened into an empty port list: that
            // would emit ports-updated with [], clearing the UI's rows and its
            // error banner, and would make the logger record every live port as
            // stopped. Skip the tick instead and tell the frontend why.
            let ports = match scanner::try_scan_ports() {
                Ok(ports) => {
                    if degraded {
                        degraded = false;
                        let _ = app_handle.emit("scan-recovered", ());
                    }
                    // Every completed scan, whether or not anything changed.
                    // `ports-updated` below is deliberately gated on the data
                    // differing — re-rendering the whole table every two
                    // seconds for an identical list is waste — but the UI's
                    // "Last scan" line was reading that same event, so on a
                    // quiet machine it climbed to minutes while scanning was
                    // perfectly healthy, which is what a stalled scanner looks
                    // like. Liveness and change are different facts; this
                    // carries the first one.
                    let _ = app_handle.emit("scan-completed", ());
                    ports
                }
                Err(error) => {
                    if !degraded {
                        degraded = true;
                        eprintln!("PortPal scan failed [{}]: {}", error.code, error.message);
                        let _ = app_handle.emit("scan-degraded", &error);
                    }
                    continue;
                }
            };

            let new_state = compute_state(&ports);
            let port_count = ports.iter().filter(|p| is_tray_dev_port(p.port)).count();

            // Update the logger with current ports and connection counts.
            // One snapshot per tick: `ports` comes from a single
            // try_scan_ports() call and is reused for both the logger tuples
            // and the graph input, so listing and connection stages can never
            // disagree about what is live.
            {
                let port_tuples: Vec<(u16, u32, String, Option<String>, Option<String>)> = ports
                    .iter()
                    .map(|p| {
                        let fw = crate::taxonomy::get_framework_name(p.port);
                        (
                            p.port,
                            p.pid,
                            p.process_name.clone(),
                            fw,
                            p.project_path.clone(),
                        )
                    })
                    .collect();

                // Get connection counts from the graph (single connection-tool
                // spawn per tick, inside get_port_graph).
                let listening: Vec<(u16, u32, String, Option<String>)> = ports
                    .iter()
                    .map(|p| {
                        (
                            p.port,
                            p.pid,
                            p.process_name.clone(),
                            p.project_name.clone(),
                        )
                    })
                    .collect();
                let graph = crate::connections::get_port_graph(&listening);
                // Sum across conflicting PIDs sharing a port (last-wins would
                // undercount conflicts to a single endpoint's share).
                let mut conn_counts = std::collections::HashMap::new();
                for node in &graph.nodes {
                    *conn_counts.entry(node.port).or_insert(0) += node.connection_count;
                }

                let mut logger = lock_recover(&crate::logger::LOGGER);
                let new_events = logger.update(&port_tuples, &conn_counts);

                // Emit new events to the frontend
                if !new_events.is_empty() {
                    let _ = app_handle.emit("port-events", &new_events);
                }
            }

            let should_update = {
                let mut db = lock_recover(&debounce);

                if db.pending != new_state {
                    // State changed — reset debounce timer
                    db.pending = new_state.clone();
                    db.since = Instant::now();
                    false
                } else if db.current != new_state && db.since.elapsed() >= Duration::from_secs(4) {
                    // Stable for 4s and different from current — update
                    db.current = new_state.clone();
                    true
                } else {
                    false
                }
            };

            if should_update {
                if let Some(tray) = app_handle.tray_by_id("main") {
                    let icon_bytes = get_icon_bytes(&new_state);
                    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                        let _ = tray.set_icon(Some(icon));
                    }
                    let tooltip = get_tooltip(&new_state, port_count);
                    let _ = tray.set_tooltip(Some(&tooltip));
                }

                // Emit event to frontend so UI stays in sync
                let _ = app_handle.emit("tray-state-changed", new_state.clone());
            }

            // Only emit port updates to frontend if data changed
            if let Ok(json) = serde_json::to_string(&ports) {
                let mut last = lock_recover(&last_ports_json);
                if *last != json {
                    *last = json;
                    let _ = app_handle.emit("ports-updated", &ports);
                }
            }
        }
    });

    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::PortInfo;

    fn p(port: u16) -> PortInfo {
        PortInfo {
            port,
            pid: 1,
            process_name: "test".into(),
            project_path: None,
            project_name: None,
            protocol: "TCP".into(),
            start_cmd: None,
            cwd: None,
            env: None,
        }
    }

    #[test]
    fn clear_when_no_ports() {
        assert_eq!(compute_state(&[]), TrafficState::Clear);
    }

    #[test]
    fn clear_when_only_system_ports() {
        let ports = vec![p(49664), p(49665), p(135)];
        assert_eq!(compute_state(&ports), TrafficState::Clear);
    }

    #[test]
    fn active_when_dev_port_present() {
        assert_eq!(compute_state(&[p(3000)]), TrafficState::Active);
        assert_eq!(compute_state(&[p(5173)]), TrafficState::Active);
        assert_eq!(compute_state(&[p(1420)]), TrafficState::Active);
        assert_eq!(compute_state(&[p(49664), p(3000)]), TrafficState::Active);
    }

    #[test]
    fn conflict_when_duplicate_port() {
        let ports = vec![p(3000), PortInfo { pid: 2, ..p(3000) }];
        assert_eq!(compute_state(&ports), TrafficState::Active);

        let ports = vec![
            p(3000),
            PortInfo {
                pid: 2,
                process_name: "other".into(),
                ..p(3000)
            },
        ];
        assert_eq!(compute_state(&ports), TrafficState::Conflict);
        // Conflict takes precedence over Active
        let ports2 = vec![
            p(3000),
            p(5173),
            PortInfo {
                pid: 2,
                process_name: "other".into(),
                ..p(3000)
            },
        ];
        assert_eq!(compute_state(&ports2), TrafficState::Conflict);
    }

    #[test]
    fn same_process_name_with_different_projects_is_a_conflict() {
        let ports = vec![
            PortInfo {
                project_path: Some("C:/one".into()),
                ..p(3000)
            },
            PortInfo {
                pid: 2,
                project_path: Some("C:/two".into()),
                ..p(3000)
            },
        ];
        assert_eq!(compute_state(&ports), TrafficState::Conflict);
    }

    #[test]
    fn tooltip_messages() {
        assert_eq!(get_tooltip(&TrafficState::Clear, 0), "PortPal — All clear");
        assert_eq!(
            get_tooltip(&TrafficState::Active, 1),
            "PortPal — 1 dev port active"
        );
        assert_eq!(
            get_tooltip(&TrafficState::Active, 3),
            "PortPal — 3 dev ports active"
        );
        assert_eq!(
            get_tooltip(&TrafficState::Conflict, 0),
            "PortPal — ⚠ Port conflict detected!"
        );
    }

    #[test]
    fn debounce_state_initial() {
        let db = DebounceState::new();
        assert_eq!(db.current, TrafficState::Clear);
        assert_eq!(db.pending, TrafficState::Clear);
    }

    #[test]
    fn icon_and_tooltip_agree_on_8888() {
        // Regression: tooltip counter once omitted 8888 while compute_state
        // treated it as dev, yielding Active icon with "0 dev ports".
        // Both now derive from taxonomy::is_dev_port.
        let ports = vec![p(8888)];
        assert_eq!(compute_state(&ports), TrafficState::Active);
        let count = ports.iter().filter(|p| is_tray_dev_port(p.port)).count();
        assert_eq!(count, 1);
        assert_eq!(
            get_tooltip(&TrafficState::Active, count),
            "PortPal — 1 dev port active"
        );
    }

    #[test]
    fn tray_taxonomy_matches_graph() {
        // Backend surfaces must agree: every graph dev port is a tray dev port.
        for (port, _) in crate::taxonomy::DEV_PORTS {
            assert!(
                is_tray_dev_port(*port),
                "tray missing graph dev port {port}"
            );
        }
    }
}
