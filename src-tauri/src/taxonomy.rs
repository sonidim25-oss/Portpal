//! Single source of truth for PortPal's port taxonomy and kill policy.
//!
//! Which ports are dev ports, which are critical infrastructure, and which
//! process names are protected used to live in near-duplicate tables spread
//! across `scanner.rs`, `connections.rs`, and three TypeScript files — with
//! nothing enforcing agreement. A missed edit on one side silently weakened
//! the kill guard or diverged tray/graph/status surfaces.
//!
//! The tables now live here for Rust (`scanner` and `connections` import from
//! this module) and in `src/app/taxonomy.ts` for TypeScript. Both sides assert
//! set equality against `shared/taxonomy.json` in their test suites, so drift
//! fails tests instead of shipping.

/// Ports whose listeners are protected from kills on every platform.
///
/// Host configuration (`PORTPAL_CRITICAL_PORTS`) can only *add* protection;
/// these defaults cannot be removed.
pub const CRITICAL_PORTS: &[u16] = &[22, 80, 443, 3306, 5432, 6379, 27017];

/// Protected process names: lowercase, without any `.exe` suffix.
/// Compared via [`is_protected_process_name`], never by direct equality.
pub const CRITICAL_PROCESS_NAMES: &[&str] = &[
    "system",
    "svchost",
    "lsass",
    "postgres",
    "redis-server",
    "mysqld",
    "mongod",
];

/// Normalizes a process name for the protected-name check: ASCII-lowercased
/// with one trailing `.exe` stripped. Matches the previous inline logic in
/// `scanner::validate_kill` and the TypeScript `isCriticalProcessName`.
pub fn normalize_process_name(process_name: &str) -> String {
    let name = process_name.to_ascii_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

/// Whether a process name is protected from kills, ignoring case and an
/// optional `.exe` suffix (`postgres` and `Postgres.exe` both match).
pub fn is_protected_process_name(process_name: &str) -> bool {
    CRITICAL_PROCESS_NAMES.contains(&normalize_process_name(process_name).as_str())
}

/// Dev-port table shared by the graph (`is_dev` / `framework` node fields)
/// and the tray (liveness icon and tooltip count), so those surfaces can
/// never diverge into per-surface port lists.
pub const DEV_PORTS: &[(u16, &str)] = &[
    (3000, "React"), (3001, "React"), (4000, "Node"),
    (4200, "Angular"), (5173, "Vite"), (5174, "Vite"),
    (8000, "Django"), (8080, "HTTP"), (8888, "Jupyter"),
    (5432, "Postgres"), (3306, "MySQL"), (6379, "Redis"),
    (27017, "Mongo"), (9000, "PHP"), (1420, "Tauri"),
    (4173, "Vite"), (2000, "Node"), (8443, "HTTPS"),
];

/// Backend dev-port set for tray/liveness surfaces, so icon, tooltip, and
/// graph liveness derive from the same table instead of three copies.
/// Tests iterate [`DEV_PORTS`] directly; no accessor wrapper is kept.
pub fn get_framework_name(port: u16) -> Option<String> {
    DEV_PORTS
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, f)| f.to_string())
}

pub fn is_dev_port(port: u16) -> bool {
    DEV_PORTS.iter().any(|(p, _)| *p == port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct DevPortEntry {
        port: u16,
        framework: String,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TaxonomyFixture {
        critical_ports: Vec<u16>,
        critical_process_names: Vec<String>,
        dev_ports: Vec<DevPortEntry>,
    }

    fn fixture() -> TaxonomyFixture {
        serde_json::from_str(include_str!("../../shared/taxonomy.json"))
            .expect("shared/taxonomy.json parses")
    }

    #[test]
    fn critical_ports_match_shared_fixture() {
        assert_eq!(CRITICAL_PORTS, fixture().critical_ports.as_slice());
    }

    #[test]
    fn critical_process_names_match_shared_fixture() {
        let fixture = fixture();
        let theirs: Vec<&str> = fixture
            .critical_process_names
            .iter()
            .map(String::as_str)
            .collect();
        assert_eq!(CRITICAL_PROCESS_NAMES, theirs.as_slice());
    }

    #[test]
    fn dev_ports_match_shared_fixture() {
        let theirs = fixture().dev_ports;
        assert_eq!(DEV_PORTS.len(), theirs.len(), "dev table drifted from fixture");
        for ((port, framework), entry) in DEV_PORTS.iter().zip(theirs.iter()) {
            assert_eq!(*port, entry.port);
            assert_eq!(*framework, entry.framework);
        }
    }

    #[test]
    fn protected_names_ignore_case_and_exe_suffix() {
        assert!(is_protected_process_name("postgres"));
        assert!(is_protected_process_name("Postgres.exe"));
        assert!(is_protected_process_name("SVCHOST.EXE"));
        assert!(is_protected_process_name("redis-server"));
        assert!(!is_protected_process_name("node"));
        assert!(!is_protected_process_name("postgres-helper"));
        assert!(!is_protected_process_name(""));
    }
}
