use serde::Serialize;
use std::process::Command;
use std::collections::HashSet;
use sysinfo::System;

#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub protocol: String,
    pub start_cmd: Option<String>,
}

// ─── Entry point (platform router) ───────────────────────────────────────────

pub fn scan_ports() -> Vec<PortInfo> {
    let mut sys = System::new();
    sys.refresh_processes();

    #[cfg(target_os = "windows")]
    return scan_windows(&sys);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return scan_unix(&sys);
}

pub fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return kill_windows(pid);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return kill_unix(pid);
}

// ─── Windows ─────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_windows(sys: &System) -> Vec<PortInfo> {
    let output = Command::new("netstat")
        .args(["-ano"])
        .output()
        .expect("failed to run netstat");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports: Vec<PortInfo> = Vec::new();
    let mut seen_entries: HashSet<(u16, u32)> = HashSet::new();

    for line in stdout.lines() {
        if !line.contains("LISTENING") { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 { continue; }

        let port: u16 = match parts[1].rsplit(':').next()
            .and_then(|p| p.parse().ok()) {
            Some(p) => p,
            None => continue,
        };

        let pid: u32 = match parts[4].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        if pid == 0 || seen_entries.contains(&(port, pid)) { continue; }
        seen_entries.insert((port, pid));

        let mut process_name = format!("PID {}", pid);
        let mut project_path = None;
        let mut start_cmd = None;

        if let Some(process) = sys.process(sysinfo::Pid::from(pid as usize)) {
            let p_name = process.name().to_string();
            if !p_name.trim().is_empty() {
                process_name = p_name;
            }

            let cmd_arr = process.cmd();
            let cmd_str = cmd_arr.join(" ");

            if !cmd_str.trim().is_empty() {
                start_cmd = Some(cmd_str.trim().to_string());
            }

            if let Some(cwd) = process.cwd() {
                project_path = find_project_root(cwd).map(|p| p.to_string_lossy().to_string());
            }

            if project_path.is_none() {
                if let Some(exe) = process.exe() {
                    if let Some(parent) = exe.parent() {
                        project_path = find_project_root(parent).map(|p| p.to_string_lossy().to_string());
                    }
                }
            }
        }

        let project_name = extract_project_name(&project_path);

        ports.push(PortInfo {
            port, pid, process_name,
            project_path, project_name,
            protocol: "TCP".into(),
            start_cmd,
        });
    }

    ports.sort_by_key(|p| p.port);
    ports
}

#[cfg(target_os = "windows")]
fn kill_windows(pid: u32) -> Result<(), String> {
    let output = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() { Ok(()) }
    else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}

// ─── macOS + Linux (shared lsof path) ────────────────────────────────────────

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn scan_unix(sys: &System) -> Vec<PortInfo> {
    let output = Command::new("lsof")
        .args(["-iTCP", "-sTCP:LISTEN", "-n", "-P"])
        .output()
        .expect("failed to run lsof — is it installed?");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports: Vec<PortInfo> = Vec::new();
    let mut seen_entries: HashSet<(u16, u32)> = HashSet::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 { continue; }

        let mut process_name = parts[0].to_string();
        let pid: u32 = match parts[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let mut idx = parts.len() - 1;
        if parts[idx].starts_with('(') {
            idx -= 1;
        }
        let name = parts[idx];
        let port: u16 = match name.rsplit(':').next()
            .and_then(|p| p.parse().ok()) {
            Some(p) => p,
            None => continue,
        };

        if seen_entries.contains(&(port, pid)) { continue; }
        seen_entries.insert((port, pid));

        let mut project_path = None;
        let mut start_cmd = None;

        if let Some(process) = sys.process(sysinfo::Pid::from(pid as usize)) {
            let sys_name = process.name().to_string();
            if !sys_name.is_empty() { process_name = sys_name; }

            if let Some(cwd) = process.cwd() {
                project_path = find_project_root(cwd).map(|p| p.to_string_lossy().to_string());
            }

            let cmd = process.cmd().join(" ");
            if !cmd.trim().is_empty() {
                start_cmd = Some(cmd);
            }
        }

        if project_path.is_none() {
            project_path = get_project_path_unix_fallback(pid);
        }

        let project_name = extract_project_name(&project_path);

        ports.push(PortInfo {
            port, pid, process_name,
            project_path, project_name,
            protocol: "TCP".into(),
            start_cmd,
        });
    }

    ports.sort_by_key(|p| p.port);
    ports
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn get_project_path_unix_fallback(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let cwd = std::fs::read_link(format!("/proc/{}/cwd", pid)).ok()?;
        find_project_root(std::path::Path::new(&cwd)).map(|p| p.to_string_lossy().to_string())
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("lsof")
            .args(["-p", &pid.to_string(), "-a", "-d", "cwd", "-Fn"])
            .output()
            .ok()?;

        let s = String::from_utf8_lossy(&output.stdout);
        let cwd = s.lines()
            .find(|l| l.starts_with('n') && l.len() > 1)
            .map(|l| l[1..].to_string())?;

        find_project_root(std::path::Path::new(&cwd))
            .map(|p| p.to_string_lossy().to_string())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn kill_unix(pid: u32) -> Result<(), String> {
    unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    std::thread::sleep(std::time::Duration::from_secs(2));

    if process_exists_unix(pid) {
        unsafe { libc::kill(pid as i32, libc::SIGKILL); }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn process_exists_unix(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

fn find_project_root(start: &std::path::Path) -> Option<std::path::PathBuf> {
    let markers = [
        "package.json", "Cargo.toml", "go.mod",
        "pyproject.toml", "requirements.txt",
        "pom.xml", "build.gradle", ".git",
    ];
    let mut dir = start.to_path_buf();
    for _ in 0..6 {
        for marker in &markers {
            if dir.join(marker).exists() {
                return Some(dir);
            }
        }
        if !dir.pop() { break; }
    }
    None
}

fn extract_project_name(path: &Option<String>) -> Option<String> {
    path.as_ref()
        .and_then(|p| std::path::Path::new(p).file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

// ─── Test helpers (pure, no OS calls) ───────────────────────────────────────

#[cfg(test)]
pub(crate) fn parse_netstat_port(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.parse().ok()
}

#[cfg(test)]
pub(crate) fn parse_lsof_name_parts(parts: &[&str]) -> Option<u16> {
    if parts.len() < 9 {
        return None;
    }
    let mut idx = parts.len() - 1;
    if parts[idx].starts_with('(') {
        if idx == 0 {
            return None;
        }
        idx -= 1;
    }
    let name = parts[idx];
    name.rsplit(':').next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn extract_project_name_some() {
        let p = Some("C:/Users/123da/PycharmProjects/PortPal".to_string());
        assert_eq!(extract_project_name(&p), Some("PortPal".to_string()));
        let p2 = Some("C:/a/b/c".to_string());
        assert_eq!(extract_project_name(&p2), Some("c".to_string()));
    }

    #[test]
    fn extract_project_name_none() {
        assert_eq!(extract_project_name(&None), None);
        let p = Some("".to_string());
        // Path::new("").file_name() == None
        assert_eq!(extract_project_name(&p), None);
    }

    #[test]
    fn find_project_root_direct_marker() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("package.json"), "{}").unwrap();
        let sub = dir.path().join("a/b");
        fs::create_dir_all(&sub).unwrap();
        let found = find_project_root(&sub);
        assert_eq!(found, Some(dir.path().to_path_buf()));
    }

    #[test]
    fn find_project_root_cargo_toml() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        let found = find_project_root(dir.path());
        assert_eq!(found, Some(dir.path().to_path_buf()));
    }

    #[test]
    fn find_project_root_git_marker() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        let found = find_project_root(dir.path());
        assert_eq!(found, Some(dir.path().to_path_buf()));
    }

    #[test]
    fn find_project_root_none_within_6_levels() {
        let dir = tempdir().unwrap();
        let deep = dir.path().join("a/b/c/d/e/f/g");
        fs::create_dir_all(&deep).unwrap();
        // marker only at top, but deep is 7 levels down -> not found
        fs::write(dir.path().join("package.json"), "{}").unwrap();
        let found = find_project_root(&deep);
        assert_eq!(found, None);
    }

    #[test]
    fn find_project_root_parent_traversal() {
        let dir = tempdir().unwrap();
        let lvl1 = dir.path().join("level1");
        let lvl2 = lvl1.join("level2");
        fs::create_dir_all(&lvl2).unwrap();
        fs::write(lvl1.join("go.mod"), "module x").unwrap();
        let found = find_project_root(&lvl2);
        assert_eq!(found, Some(lvl1));
    }

    #[test]
    fn parse_netstat_port_ipv4_and_ipv6() {
        assert_eq!(parse_netstat_port("0.0.0.0:3000"), Some(3000));
        assert_eq!(parse_netstat_port("127.0.0.1:5173"), Some(5173));
        assert_eq!(parse_netstat_port("[::]:1420"), Some(1420));
        assert_eq!(parse_netstat_port("10.0.0.5:49664"), Some(49664));
        assert_eq!(parse_netstat_port(":::8080"), Some(8080));
        assert_eq!(parse_netstat_port("invalid"), None);
        assert_eq!(parse_netstat_port("0.0.0.0:abc"), None);
    }

    #[test]
    fn parse_lsof_without_listen_suffix() {
        let parts: Vec<&str> = "node 1234 user 10u IPv4 0x... 0t0 TCP *:3000".split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts), Some(3000));
    }

    #[test]
    fn parse_lsof_with_listen_suffix_pr8() {
        // PR #8: lsof appends "(LISTEN)" as separate token
        let line = "node 1234 user 10u IPv4 0x... 0t0 TCP *:3000 (LISTEN)";
        let parts: Vec<&str> = line.split_whitespace().collect();
        // The ports.len()-1 is "(LISTEN)", must fall back to previous token
        assert_eq!(parse_lsof_name_parts(&parts), Some(3000));
        let line2 = "com.apple 5678 user 11u IPv6 0x... 0t0 TCP [::1]:5173 (LISTEN)";
        let parts2: Vec<&str> = line2.split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts2), Some(5173));
    }

    #[test]
    fn parse_lsof_too_short() {
        let parts: Vec<&str> = "a b c".split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts), None);
    }

    #[test]
    fn dedupe_seen_entries() {
        let mut seen: HashSet<(u16, u32)> = HashSet::new();
        assert!(seen.insert((3000, 1234)));
        assert!(!seen.insert((3000, 1234))); // duplicate
        assert!(seen.insert((3000, 5678))); // same port, different pid
        assert!(seen.insert((5173, 1234))); // different port, same pid
        assert_eq!(seen.len(), 3);
    }
}
