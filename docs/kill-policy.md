# Process termination policy

The September 2026 safety fix supersedes the September 2 redesign spec's immediate, no-confirmation Kill All requirement (spec lines 182/330 and plan line 560). Bulk termination can discard database writes and interrupt system services, so Kill All now opens a keyboard-accessible confirmation naming protected services before any dispatch. Cancel and Escape perform no kills; focus starts on Cancel and returns to the trigger.

The backend `kill_process` command still accepts only `{ pid }`. Both Rust entry points call the same scanner policy. Before signaling, it rejects PID 0/1 and IDs outside the positive signed PID range, rescans current listeners, requires the PID in that scan, verifies live process metadata, and denies critical names or ports across every listener of that PID. Errors serialize as `{ code, message }` and are displayed in the frontend. Restart still accepts only `{ port, pid }`, uses `restart_trusted`, and its kill step also obeys the policy.

Protected names (case insensitive, optional `.exe`) are system, svchost, lsass, postgres, redis-server, mysqld, and mongod. Default protected ports are 22, 80, 443, 3306, 5432, 6379, and 27017. Administrators may add comma-separated ports through the host environment variable `PORTPAL_CRITICAL_PORTS`; defaults cannot be removed. This patch intentionally exposes no critical-process override through the PID-only IPC: confirming acknowledges the protected-service warning, and those processes are skipped. A future override would require a separately designed trusted authorization flow.

Bulk selection is a snapshot of distinct PIDs, retaining the first displayed row. Dispatch is sequential, skips busy and critical PIDs, rechecks current rows before each request, and reports killed, failed, critical-skipped, and busy-skipped counts. The hook also deduplicates in-flight requests synchronously and preserves rows after errors. Single critical-process actions open the same warning and cannot terminate the protected service.

## How a process is stopped

Both platforms now ask before they force, on the same `GRACEFUL_STOP_GRACE` (2s)
budget defined once in `scanner.rs`:

| | Ask | Wait | Force |
|---|---|---|---|
| Unix | `SIGTERM` | up to 2s, returning the moment the process exits | `SIGKILL`, after re-checking process start time |
| Windows | WM_CLOSE, posted by `taskkill /PID n` (no `/F`) | `WaitForSingleObject` on the process handle | `TerminateProcess` on that handle |

Windows used to run `taskkill /PID n /F` and nothing else — immediate, unconditional
force on the platform PortPal is used on most, while the confirmation dialog warned
about unsaved data. It now asks first.

The ask only reaches a process that owns a window. A windowless console server — most
dev servers — has nothing to post WM_CLOSE to, and `taskkill` says so by failing
("This process can only be terminated forcefully"), which is the signal to escalate
immediately rather than wait out a grace period nothing can answer. The alternative
that would reach a console process, `AttachConsole` plus `GenerateConsoleCtrlEvent`,
is deliberately not used: a console control event goes to every process sharing that
console, including the shell the user started the server from. That widens the blast
radius the same way `/T` would.

`TerminateProcess` only *initiates* termination, so the Windows path waits for the
handle to signal before reporting success. Otherwise a STOPPED row could appear while
the port was still bound.

## PID reuse

The Windows race is closed. `kill_pid` opens a process handle **before** the scan that
validates the process, and Windows keeps a process ID reserved for as long as a handle
to that process object is open. The validating scan and the terminate therefore act on
one fixed process; the terminate goes through the handle, never through the number
again. `ProcessHandle::open` also separates "this user cannot stop that process"
(`access_denied` — run elevated) from "it is gone" (`not_observed` — rescan).

On Unix the delayed `SIGKILL` still re-checks process start time, but the initial
`SIGTERM` is sent by PID and remains theoretically raceable; closing that needs
`pidfd_open`/`pidfd_send_signal`, which is Linux-only and has no macOS equivalent.

## Blast radius: one process, not its tree

PortPal stops the listener it showed, never a process tree. Windows `taskkill /T` and
a `kill(-pgid)` equivalent were both rejected: the listening socket belongs to the PID
on screen, and a tree kill would terminate processes the user never saw and the UI
cannot honestly enumerate.

The cost is disclosed in the confirmation dialog rather than hidden: a child that
inherited the listening socket can keep the port bound after the parent dies, and a
supervisor child can restart the service. Revisiting this decision means changing the
dialog text in the same commit.

## Verification

Unit and integration tests cover cancellation, focus and keyboard traversal, Postgres
warnings, duplicate PIDs, busy skips, partial failures, typed backend errors,
allowlist/deny-list decisions, and unchanged kill/restart payloads. Live destructive
checks against real system services are not appropriate verification; cancellation and
backend rejection are tested without signaling them.

The Windows kill path is tested against processes the test suite spawns itself
(`scanner::tests::windows_*`): graceful-before-force, that a windowless child is not
billed the grace period, that a PID stays pinned while a handle is open, that
terminating an already-exited process is success, and that opening a PID that is not
running is a typed error. Observed behaviour backing the doc above: `taskkill /PID`
without `/F` exits 1 with "can only be terminated forcefully" for a console child and
leaves it running, and succeeds for a process that owns a window.

The Unix branch still requires native Linux/macOS validation; Windows compilation
cannot execute it.
