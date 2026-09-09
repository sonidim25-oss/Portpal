# PortPal — Code Review Task List

Full-codebase review: `src-tauri/src/**` (Rust backend), `src/**` (React/TypeScript
frontend), `dev/`, and build/security configuration (`vite.config.ts`,
`tauri.conf.json`, `capabilities/`, `.env*`, `index.html`).

**31 tasks** — 1 Extra High, 5 High, 15 Medium, 10 Low.

Status legend: `[ ]` open · `[x]` done · `[~]` resolved outside this work

---

## Summary

| Priority | Total | Done | Open |
|---|---|---|---|
| EXTRA HIGH | 1 | 1 | 0 |
| HIGH | 5 | 5 | 0 |
| MEDIUM | 15 | 1 | 14 |
| LOW | 10 | 10 | 0 |
| **Total** | **31** | **17** | **14** |

General note: the shipped `src-tauri` and `src` code is unusually well hardened. The
restart path is a trusted-store replay with a real jail, the PID 0/1 policy is coherent,
and scan failures are typed rather than flattened into empty lists. The remaining findings
cluster in platform assumptions, frontend destructive-action UX, and duplicated policy
tables.

---

# EXTRA HIGH

## [~] Task: Unhardened duplicate of the application with an RCE command in the working tree

- **Location**: `Test/src-tauri/src/main.rs` (Lines 50-79), `Test/src-tauri/src/lib.rs` (Lines 28-60), `Test/index.html`, `Test/src-tauri/tauri.conf.json`
- **Description**: `Test/` was a complete, buildable copy of PortPal at a pre-hardening
  revision. Its `restart_process` took `cmd: String` and `cwd: String` directly from the
  webview and executed `Command::new("cmd").args(["/C","start","cmd","/K",&cmd])` — an
  unvalidated string handed to a command interpreter. Any script execution in the webview
  became arbitrary code execution as the user; that copy also had no CSP (`app.security`
  absent from its `tauri.conf.json`), no critical-process kill guard, and
  `LOGGER.lock().unwrap()` panicking on poisoning. It was untracked and absent from
  `.gitignore`, so `git add -A` would have republished it.
- **Suggested Fix**: Delete the directory; verify no ref still carries the
  `restart_process(pid, cmd, cwd)` signature.
- **Status**: `Test/` was removed outside this session (between 20:24 and 20:37 on
  2026-09-08). No `.rs` file in the tree matches the pattern any more. Audited every ref:
  clean on `main` / `origin/main`; **still vulnerable on `upstream/main`**
  (`wisher567/Portpal`, 51 commits behind, 0 ahead — confirmed after a fresh fetch),
  `origin/master`, `upstream/master`, `origin/sonidim25-oss/Test`, and `stash@{0}`
  (base `b8abd8f`). Deleted three stale local branches after confirming each was
  superseded: `feat/port-intel-wiring` (`0a6a51e`), `pr-6` (`73f735a`), `pr-8` (`2c93697`).
  **Nothing was sent upstream, at the user's explicit instruction** — upstream therefore
  remains vulnerable by decision, not oversight.

---

# HIGH

## [x] Task: Windows port scanning depends on English-localized `netstat` output

- **Location**: `src-tauri/src/scanner.rs` (was Line 244), `src-tauri/src/connections.rs` (was Line 257)
- **Description**: Both parsers filtered rows with `line.contains("LISTENING")` /
  `line.contains("ESTABLISHED")`. Windows localizes the State column (German `ABHÖREN`,
  Spanish `ESCUCHANDO`, French `À L'ÉCOUTE`, Italian `IN ATTESA`). On any non-English
  Windows — the primary target platform — `netstat` exited 0 with a full page of output and
  every row was filtered out, so the UI showed a confident "No ports in use" empty state.
  The typed `ScanError` path could not catch it because nothing failed. A second latent bug
  sat underneath: the PID was read from a fixed index (`parts[4]`), so a state spanning two
  tokens (French `À L'ÉCOUTE`) shifted every later column and the row was dropped even if
  the word had been recognised.
- **Suggested Fix**: Stop reading the State column; identify a listener structurally.
- **Status**: **Done and tested.** Added `parse_netstat_tcp_row` + `NetstatTcpRow` to the
  shared `netaddr.rs` (+167 lines). It matches the Proto column (protocol names are never
  translated), identifies a listener by its null Foreign Address (`0.0.0.0:0`, `[::]:0`, or
  `*:*`), and reads the PID from the **last** token so a multi-word state cannot shift it.
  Both call sites rewired; imports `#[cfg]`-gated per platform to avoid unused-import
  warnings. 8 new tests (9 → 17 in `netaddr`) covering German/Spanish/French/Italian, IPv6
  in both roles, the multi-word-state trap, `*:*`, UDP/header/banner rejection, and
  TIME_WAIT. Full suite: **86 passed, 0 failed** on a Windows build.
- **Known trade-off**: connection *counts* now select "any row with a real peer" rather
  than strictly ESTABLISHED, so short-lived states (`CLOSE_WAIT`, `SYN_SENT`, `FIN_WAIT`)
  are included and counts may read slightly higher. `TIME_WAIT`, much the most common, is
  still excluded because Windows leaves it unattributed (PID 0). Port *listing* — the
  actual bug — is exactly as precise as before. macOS and Linux are unaffected: they pass
  the state as an argument (`lsof -sTCP:ESTABLISHED`, `ss state established`) rather than
  parsing it out of output.

## [x] Task: Children spawned by restart are never reaped

- **Location**: `src-tauri/src/scanner.rs` — `spawn_trusted` (Line 758), `kill_unix` (Lines 461-485), `restart_trusted` (Lines 800-810)
- **Description**: `command.spawn().map(|_| ())` discards the `Child` handle. On Unix
  PortPal becomes the parent, installs no `SIGCHLD` handling and never calls `wait()`, so
  the child becomes a **zombie for the lifetime of the app**. Two consequences: a slow leak
  of PID-table slots across repeated restarts; and, worse, the liveness probes lie —
  `process_exists_unix` is `kill(pid, 0) == 0`, which returns success for a zombie, as does
  `sysinfo`. Killing a process PortPal previously spawned therefore never observes the
  exit, burns the full `SIGTERM_GRACE` (2s), sends `SIGKILL` to an already-dead zombie,
  then burns the full `RESTART_SETTLE` (800ms). The comment claiming this "only ever
  returns sooner than the previous unconditional sleep" is false for exactly the processes
  PortPal itself started.
- **Suggested Fix**: Retain the `Child` (e.g. `Mutex<HashMap<(u16,u32), Child>>` beside
  `trusted_launches`) and `try_wait()` it in the tray poll loop; or double-fork / `setsid`
  so init adopts it. Add an explicit zombie check (`/proc/<pid>/stat` state `Z`, or
  `waitpid(WNOHANG)`) to `process_exists_unix`.

## [x] Task: Killing a single process requires no confirmation

- **Location**: `src/features/ports/PortsPage.tsx` — `requestKill` (Lines 66-69), `confirmKills` (Lines 70-97)
- **Description**: `requestKill` opens `KillConfirmation` **only when
  `protectedListener(port)` is truthy** — i.e. only for processes `confirmKills` then
  refuses to kill (`critical++`). For every ordinary process, one click on the row's kill
  icon terminates it immediately. The dialog's warning ("Termination can lose unsaved data
  and interrupt services") is therefore shown exclusively in the one case where nothing
  will be terminated, and never when something will. Compounded on Windows by
  `taskkill /F`, which gives the target no chance to flush. The same unconfirmed path is
  reachable from `PortInspector`'s "Kill Process" button.
- **Suggested Fix**: Invert the gate — route every kill through `KillConfirmation`, with
  the protected-service list rendered as an extra warning section rather than as the
  trigger condition. Consider a "don't ask again this session" option if single-click speed
  is the goal.
- **Status**: **Done and tested.** `requestKill` now inverts the gate: a killable port sets
  `killSelection` and opens the modal; a protected port calls `onKill` directly, which
  surfaces the "Protected service … cannot be killed" toast from `usePortPalData.killPort`
  instead of a dialog that promised an action it would never take. `confirmKills` keeps its
  `protectedListener` guard as a defensive check for Kill All, and `setKillSummary` is now
  scoped to `targets.length > 1` so single kills report through the existing per-kill toast
  rather than a bulk tally. Both entry points were already wired to `requestKill`
  (`PortsPage.tsx` Lines 209 and 224), so the previously unconfirmed "Kill Process" button
  in `PortInspector` is closed by the same change. Tests updated in `PortsPage.test.tsx`
  and `App.integration.test.tsx`: the killable path asserts the dialog is visible *before*
  `onKill` fires (so a regression fails rather than passing silently), covering mouse click
  and `Enter`; the protected path asserts `queryByRole("alertdialog")` is absent while
  `onKill` is still called. Focus-trap coverage retained. Suite: **210 passed, 0 failed**.
- **Follow-up (cosmetic)**: the dialog copy reads "1 unique process selected" for a single
  kill — bulk-kill phrasing inherited from Kill All. Naming the process and port would read
  better for the single case.

## [x] Task: Dashboard "Connections" tile navigates to a route that renders nothing

- **Location**: `src/features/dashboard/DashboardPage.tsx` (Line 29), `src/App.tsx` (Lines 53-54), `src/components/shell/Sidebar.tsx` (Lines 46-47)
- **Description**: The Port Map route was disabled for MVP — the `{page === 'map' && ...}`
  branch and the sidebar nav item are both commented out — but `'map'` remains in the
  `NavPage` union and the Dashboard's Connections tile still calls `onNavigate('map')`.
  Clicking it leaves the user in a **blank content pane with no active sidebar item**;
  because the window is frameless and there is no route guard, the only escape is another
  sidebar entry. `PortsPage` still carries the dead path too (`onOpenMap`, `openMap`,
  `void openMap`).
- **Suggested Fix**: Remove `'map'` from `NavPage` (TypeScript then flags
  `onNavigate('map')` and the unused prop chain at compile time), or add a default branch
  in `App.tsx` rendering the ports page for unrouted values. Do not leave a reachable
  navigation target with no renderer.
- **Status**: **Done.** Removed `'map'` from `NavPage`, rewired Dashboard's Connections
  tile to navigate to `'traffic'`, and removed dead navigation props and handlers.

## [x] Task: macOS scan spawns one `lsof` per unattributed PID inside a 2-second loop

- **Location**: `src-tauri/src/scanner.rs` — `scan_unix` (Line 380), `get_project_path_unix_fallback` (Lines 398-420)
- **Description**: When `sysinfo` cannot supply a `cwd` — common on macOS for any process
  not owned by the current user — the scan runs `lsof -p <pid> -a -d cwd -Fn` **once per
  listener, synchronously, inside the row loop**. A typical Mac has 30-80 TCP listeners and
  the tray thread runs the whole scan every 2 seconds, with `kill_pid`, `restart_trusted`
  and `get_port_graph` each triggering further full scans. That is potentially hundreds of
  process spawns per minute for a background tray utility.
- **Suggested Fix**: Hoist the fallback out of the loop — one
  `lsof -p <pid1>,<pid2>,… -a -d cwd -Fpn` call, parsing the `p`/`n` record pairs. Cache
  per PID across ticks, invalidating when the PID disappears, and skip it entirely for PIDs
  the project-root cache already resolved.
- **Status**: **Done; pure parser tested, platform code unverifiable here.**
  `get_project_path_unix_fallback` (one spawn per pid, called from inside the row loop) is
  replaced by `resolve_cwds(&[u32])`, called once after the loop. `scan_unix` is now two
  pass: the loop records pids `sysinfo` could not place in `needs_cwd` and pushes rows with
  `project_name: None`; after the loop the pid list is sorted, deduped and resolved in one
  go, then `project_name` is derived for every row. macOS drops from **N spawns per scan to
  exactly 1** (N = listeners without a `sysinfo` cwd, every 2s); Linux keeps its
  spawn-free `/proc/<pid>/cwd` readlink, now batched behind the same call. `find_project_root`
  stays memoized, so listeners sharing a project directory still probe the filesystem once.
  Partial failure is handled better than before: lsof exits non-zero if *any* pid is
  unreadable, so stdout is parsed regardless of exit status and the readable pids keep their
  paths.
- **Verification**: the risky part — parsing `lsof -F` output — was extracted into a pure
  `parse_lsof_cwd_records`, gated `#[cfg(any(target_os = "macos", test))]` so it compiles
  and is tested on Windows where the Unix scanner never builds. 5 new tests (86 → 91):
  batched multi-pid listing, paths containing spaces, a process whose cwd was not reported,
  an unparseable `p` line not misattributing the path beneath it, and empty/unrelated input.
  Suite: **91 passed, 0 failed**, no new warnings.
- **Caveat**: `scan_unix` and `resolve_cwds` themselves are `#[cfg]`-gated to macOS/Linux
  and **were never compiled** — `cargo check --target x86_64-unknown-linux-gnu` fails in
  tauri's GTK/glib pkg-config step before reaching this code, and no Linux sysroot is
  installed. Reviewed by eye instead; the two constructs that could plausibly fail
  (`args()` mixing `&str` with `&String`, and the two-block `#[cfg]` tail expression) are
  both patterns the replaced function already used. **Needs one build on a Mac or Linux
  box to be considered closed.**

---

# MEDIUM

## [x] Task: `observedStarts` records the oldest start timestamp, not the current one

- **Location**: `src/app/usePortPalData.ts` (Lines 33-41, 88), `src-tauri/src/logger.rs` — `get_events` (Lines 177-182)
- **Description**: `get_events` returns events reverse-chronologically (newest first).
  `observedStarts` reduces over that array assigning
  `observedAt[event.port] = event.timestamp` for every `'started'` event, so the **last**
  assignment — the oldest event — wins. For any port that has restarted, the "STARTED"
  column and the inspector's "Observed Xh ago" report the first-ever start rather than the
  current process's. Pressing Refresh on the Logs page re-runs `refreshEvents` and
  regresses a correct streamed value back to the stale one.
- **Suggested Fix**: Skip a port already in the accumulator, or take the max:
  `observedAt[p] = Math.max(observedAt[p] ?? 0, event.timestamp)`. The latter is
  order-independent and also correct for the streamed batch path.
- **Status**: **Done and tested.** Updated `observedStarts` in `src/app/usePortPalData.ts` to
  use `Math.max(observedAt[event.port] ?? 0, event.timestamp)`, accepting the existing
  `current` state as the initial record. When events are fetched or streamed in reverse
  chronological order, the newest timestamp is preserved and cannot regress. Unit test added
  in `src/app/usePortPalData.test.tsx`.

## [ ] Task: STOPPED rows ignore the active search and filters

- **Location**: `src/features/ports/PortsPage.tsx` (Lines 194-205), `src/features/ports/PortTable.tsx` (Lines 455-469)
- **Description**: `PortTable` receives `ports={filteredPorts}` but
  `killedPorts={killedPorts}` — the complete, unfiltered map — and renders every stopped
  endpoint unconditionally. Typing `3000` into search, or selecting "Dev", narrows the live
  rows while leaving all STOPPED rows visible, so the table shows results that do not match
  the query. The header count counts neither set.
- **Suggested Fix**: Run the killed entries through the same `filterPorts` call before
  passing them to `PortTable`, or pass the predicate down and apply it in both maps.

## [ ] Task: "Kill All" understates its blast radius

- **Location**: `src/features/ports/PortsPage.tsx` (Lines 58-65, 172), `src/features/ports/KillConfirmation.tsx` (Line 519)
- **Description**: Targets come from `uniqueProcesses(filteredPorts)` and the dialog says
  "N unique processes selected". But the kill is per-PID, so a process listening on several
  ports loses **all** of them — including ports the user filtered out and never saw in the
  confirmation. `usePortPalData.killPort` already snapshots `siblings` from the *unfiltered*
  list, so the code knows the blast radius is wider than the dialog admits.
- **Suggested Fix**: Compute the affected endpoint set from the unfiltered port list for
  the selected PIDs and enumerate it ("3 processes, 7 ports — including :8080 and :9229,
  hidden by the current filter").

## [ ] Task: Port taxonomy and kill policy duplicated across six tables in two languages

- **Location**: `src-tauri/src/connections.rs` (Lines 32-39), `src-tauri/src/scanner.rs` (Lines 152, 176), `src/utils/helpers.ts` (Lines 3-22, 24, 39), `src/app/killPolicy.ts` (Lines 105-106), `src/port-intel/catalog.ts`
- **Description**: Which ports are dev ports, which are critical infrastructure, and which
  process names are protected exist as `DEV_PORTS` (Rust), `CRITICAL_PORTS` + an inline
  protected-name array (Rust), `DEV_PORTS` (TS), `SYSTEM_PORTS` (TS),
  `SYSTEM_SERVICE_PORTS` (TS), `criticalPorts` + `criticalNames` (TS), and `PORT_CATALOG`
  (TS). Nothing enforces agreement; the Rust side has a `tray_taxonomy_matches_graph` test
  precisely because this drift already caused a bug (see `icon_and_tooltip_agree_on_8888`).
  Adding a protected service means editing four files across two toolchains, and a missed
  edit is a **silently weakened kill guard**. Worst instance: `SYSTEM_PORTS` (Line 24) and
  `SYSTEM_SERVICE_PORTS` (Line 39) are byte-identical sets declared 15 lines apart in one
  file, with doc comments claiming different purposes.
- **Suggested Fix**: Make the Rust tables authoritative and expose them over IPC (a
  `get_port_taxonomy` command called once at startup), or generate the TS constants from
  the Rust source at build time. Failing that, collapse the within-language duplicates and
  add a cross-language test asserting set equality against a shared JSON fixture.

## [ ] Task: External scan and kill tools are resolved through `PATH`

- **Location**: `src-tauri/src/scanner.rs` — `run_scan_tool` (Line 62), `kill_windows` (Line 312), `get_project_path_unix_fallback` (Line 407); `src-tauri/src/connections.rs` (Lines 245, 298, 340)
- **Description**: Every external invocation uses a bare program name — `netstat`,
  `taskkill`, `lsof`, `ss` — so resolution depends on the inherited `PATH`, which on both
  Windows and Unix is user-writable and often contains user-controlled directories ahead of
  system ones. An attacker able to drop a file into any earlier `PATH` entry gets their
  binary executed on a 2-second timer, and `taskkill` is invoked with
  attacker-influenceable arguments. Lower severity than direct injection (it presumes local
  write access) but cheap to close, and this app makes the call far more often than most.
- **Suggested Fix**: Resolve to absolute paths — the `System32` copies of `netstat.exe` and
  `taskkill.exe` (read `SystemRoot` from the environment, do not hardcode a drive letter),
  canonical `/usr/sbin/lsof` and `/usr/bin/ss` with a documented fallback probe. Verify the
  resolved path is not user-writable during `preflight`.

## [ ] Task: Windows kill is force-only, has a PID-reuse window, and orphans children

- **Location**: `src-tauri/src/scanner.rs` — `kill_pid` (Lines 202-230), `kill_windows` (Lines 311-320)
- **Description**: Three problems in one path. (1) **No graceful stop**:
  `taskkill /PID <n> /F` terminates immediately, whereas `kill_unix` sends `SIGTERM`,
  waits, then escalates — so the platform where PortPal is most used has the least safe
  kill, despite the UI warning about unsaved data. (2) **TOCTOU**: `kill_pid` verifies
  `process.name()` then shells out; the PID can be recycled in between and `taskkill`
  re-checks nothing. `kill_unix` guards its *escalation* against this but nothing guards
  the initial signal on either platform. (3) **Orphans**: no `/T`, so descendants survive
  and may retain handles or respawn.
- **Suggested Fix**: (1) Open with `PROCESS_TERMINATE` and post `WM_CLOSE` /
  `GenerateConsoleCtrlEvent` first, wait the same grace, then force. (2) Open a handle
  before validation and act on the handle, or re-check start time immediately before the
  kill. (3) Decide explicitly whether the process tree is in scope and reflect it in the
  confirmation dialog — `/T` changes the blast radius.

## [ ] Task: Normal multi-worker servers are reported as port conflicts

- **Location**: `src-tauri/src/tray.rs` — `compute_state` (Lines 48-64), `src-tauri/src/logger.rs` (Lines 126-148)
- **Description**: Any port appearing under more than one PID yields
  `TrafficState::Conflict` and a `"conflict"` log event. But multiple PIDs on one port is
  the *normal* topology for `SO_REUSEPORT` servers — nginx master + workers, Node
  `cluster`, Gunicorn, Puma, HAProxy. On such a machine the tray sits permanently red with
  a port-conflict tooltip and the Logs page fills with spurious events, making real
  conflicts indistinguishable from steady state.
- **Suggested Fix**: Require corroborating evidence — differing `process_name` or
  `project_path` between listeners. Same-executable multi-PID listeners should surface as
  an "N workers" annotation on a single row.

## [ ] Task: Linux silently requires two tools; only one is covered by preflight

- **Location**: `src-tauri/src/scanner.rs` — `scan_unix` (Line 326), `preflight` (Lines 93-95); `src-tauri/src/connections.rs` — `get_connections_linux` (Lines 340-345)
- **Description**: The listener scan shells out to `lsof` while the connection graph uses
  `ss`. Many minimal and container distributions ship `iproute2` but not `lsof`. A missing
  `lsof` is reported correctly, but a missing or failing `ss` is swallowed by
  `Ok(o) => o, Err(_) => return vec![]`, producing a permanently empty connection graph,
  all-zero counts, an empty Traffic page and flat "0 conns" everywhere — with **no error in
  the UI**. This contradicts `run_scan_tool`'s own documented principle that a tool which
  ran but failed must never be reported as "nothing found".
- **Suggested Fix**: Route the connection tools through the same typed-error path and
  surface a degraded state for the graph/traffic surfaces. Separately, use `ss -ltnp` for
  the Linux listener scan so the platform needs one tool, keeping `lsof` as fallback.

## [ ] Task: The packaged desktop app fetches webfonts from Google at runtime

- **Location**: `src/styles/tokens.css` (Line 1), `.env` (Line 16), `.env.production` (Line 12), `src-tauri/tauri.conf.json` (Line 14)
- **Description**: `tokens.css` opens with a remote `@import` of the Google Fonts
  stylesheet, and the production CSP has been widened with
  `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` to
  permit it. A local-only port utility therefore makes an outbound third-party request on
  every launch — leaking IP, timing and User-Agent — and renders with fallback fonts when
  offline, a common state for the very problem this tool solves. The CSP relaxation also
  permanently widens the style-injection surface. Already documented in
  `docs/dependency-audit.md` ("Known gap: remote webfonts") without being closed.
- **Suggested Fix**: Vendor the Geist and JetBrains Mono `woff2` files into
  `public/fonts/`, switch to local `@font-face`, and delete the two Google origins from all
  three CSP definitions.

## [ ] Task: Restart and the poll loop re-run full scans several times per operation

- **Location**: `src-tauri/src/scanner.rs` — `restart_trusted` (Lines 773-812), `kill_pid` (Line 219), `port_is_listening` (Line 768); `src-tauri/src/tray.rs` (Lines 127-191)
- **Description**: One `restart_process` performs a process refresh, then
  `port_is_listening` → `try_scan_ports` (full `netstat` + another refresh), then
  `kill_pid` → `try_scan_ports` again + another refresh, then `wait_until` polling a third
  `System`: **three full process-table enumerations and two port-tool spawns for a single
  restart**. Independently the tray thread runs `try_scan_ports` plus `get_port_graph` (a
  second spawn) every 2 seconds unconditionally, including while hidden to the tray — the
  app's normal resting state. The frontend adds a 4s `refreshTraffic` interval *plus* a
  `refreshTraffic` on every `ports-updated`, so traffic is fetched about twice as often as
  intended.
- **Suggested Fix**: Thread a single scan snapshot through
  `restart_trusted` → `kill_pid` → `port_is_listening` (add internal
  `*_with(ports: &[PortInfo])` variants). Back off the tray interval when the window is
  hidden. Drop either the interval or the event-driven `refreshTraffic`.

## [ ] Task: No React error boundary in a frameless, close-intercepting window

- **Location**: `src/main.tsx` (Lines 6-10), `src/App.tsx`
- **Description**: The tree renders with no `ErrorBoundary`. Any render-phase exception —
  a malformed IPC payload, an unexpected `null` in `process_name`, a bad `traffic` shape —
  unmounts the entire application. Because `decorations: false`, the titlebar controls are
  React components inside that tree, so **the user loses minimize, maximize and close along
  with the content**, and `on_window_event` intercepts the OS close anyway. The only
  recovery is the tray menu, which a user staring at a blank rectangle has no reason to
  find.
- **Suggested Fix**: Wrap `<App />` in an error boundary rendering a minimal fallback with
  a reload action, and render the window controls outside it (or duplicate them in the
  fallback) so the chrome survives a content crash.

## [ ] Task: Tauri capability grants `core:default` rather than the permissions used

- **Location**: `src-tauri/capabilities/default.json` (Lines 6-14)
- **Description**: The capability lists six specific `core:window:*` permissions and then
  also grants `core:default`, the aggregate default set (app, event, image, menu, path,
  resources, tray, webview, window). The frontend needs only event listening plus the six
  window operations already enumerated. Granting the aggregate defeats the purpose of
  listing them and leaves capabilities enabled that no code calls — the first surface a
  webview compromise would reach for, in an app whose IPC can terminate processes.
- **Suggested Fix**: Replace `core:default` with the minimal explicit set
  (`core:event:allow-listen`, `core:event:allow-unlisten`, plus anything
  `@tauri-apps/api/window` needs beyond the six listed) and confirm the app still starts.
  Re-audit when new APIs are introduced.

## [ ] Task: Per-endpoint traffic samples are merged by array index

- **Location**: `src-tauri/src/logger.rs` — `get_traffic` (Lines 184-202)
- **Description**: When several PIDs listen on one port, `get_traffic` sums their samples
  **by position in the vector** and takes `max` of the timestamps. Those vectors are
  independent ring buffers that began filling at different times and are trimmed
  independently, so index `i` of one endpoint does not describe the same instant as index
  `i` of another. The merged series adds unrelated moments while presenting a single
  coherent timestamp, and the Traffic sparkline and peak figure derive from it. Given the
  conflict false-positive above, this path is hit by ordinary multi-worker servers.
- **Suggested Fix**: Key samples by timestamp bucket rather than index — a
  `BTreeMap<u64, usize>` bucketed to the poll interval, emitting one sample per bucket.
  Endpoints missing a bucket contribute zero rather than shifting the alignment.

## [ ] Task: Killed endpoints without a launch record vanish with no STOPPED row

- **Location**: `src/app/usePortPalData.ts` — `killPort` (Lines 203-209)
- **Description**: `setKilledPorts` only records an endpoint when it has both a
  `start_cmd` and a `project_path`. Every other killed endpoint is removed from `ports` and
  never added to `killedPorts`, so the row disappears the instant the kill returns. The
  user gets a toast and no persistent trace, while a *restartable* process leaves a visible
  STOPPED row — two different outcomes for the same action, differentiated by a condition
  the user cannot see, and the "did that work?" question has no on-screen answer for
  exactly the processes PortPal cannot bring back.
- **Suggested Fix**: Record every killed endpoint and let the row's affordances (restart
  button present or absent) express restartability, which `PortTable` already handles via
  its own `restartable` check.

## [ ] Task: `observedAt` accumulates entries for ports that no longer exist

- **Location**: `src/app/usePortPalData.ts` (Lines 88, 160)
- **Description**: Both `refreshEvents` and the `onPortEvents` stream merge into
  `observedAt` by spreading the previous map, and nothing ever removes a key. The backend
  deliberately purges `first_seen` and `traffic` for stopped endpoints (`logger.rs`
  Lines 160-164) to prevent exactly this, but the frontend mirror grows without bound for
  the life of the window — and the window is never closed, only hidden.
- **Suggested Fix**: Prune `observedAt` in the `onPortsUpdated` handler against the live
  port set, as `killedPorts` already is (Lines 143-154).

---

# LOW

## [x] Task: `CLAUDE.md` documents an architecture that no longer exists

- **Location**: `CLAUDE.md` — "Rust / Tauri" section
- **Description**: It states that `main.rs` and `lib.rs` are "near-duplicate entrypoints",
  that both build their own `tauri::Builder`, that new commands must be registered in both,
  that `lib.rs` has an extra `greet` command and registers `tauri_plugin_opener` /
  `tauri_plugin_dialog`, and that the scanners `.expect(...)` so a missing binary panics.
  In the **working tree** none of this holds: `main.rs` is a 10-line wrapper delegating to
  `portpal_lib::run`, there is one `Builder`, no `greet`, no plugins, and `run_scan_tool`
  returns typed errors precisely so nothing panics. Note: that refactor is currently
  uncommitted — the *committed* `main.rs` is still 116 lines with its own Builder and six
  duplicated commands, so the doc matches HEAD but not the tree.
- **Suggested Fix**: Once the entrypoint refactor is committed, rewrite the section for the
  single-entrypoint design and note that the panic-free scan contract is intentional.
- **Status**: **Done.** Rewritten in `1c82e82` for the single-entrypoint design
  (`lib.rs` owns the `Builder`, `main.rs` is a 10-line wrapper), with the panic-free
  scan contract, `parse_netstat_tcp_row`, test/build commands, and git conventions.

## [x] Task: The Tauri command-mirroring hook is permanently a no-op

- **Location**: `.claude/hooks/check-tauri-mirror.mjs` (Lines 26-36, 55-56), `.claude/settings.json`
- **Description**: `commandsIn` looks for a `generate_handler!` block and returns `null`
  when absent. With the working tree's `main.rs` carrying no such block, that value is
  always `null` and the early-return fires every time. The hook runs on every Write/Edit to
  those files and can never report anything — dead weight that also encodes the obsolete
  two-builder architecture it was written to police.
- **Suggested Fix**: Delete the hook and its `settings.json` entry once the
  single-entrypoint refactor lands, since the drift it guarded against becomes structurally
  impossible.
- **Status**: **Done.** Deleted `.claude/hooks/check-tauri-mirror.mjs` and reset
  `.claude/settings.json` to `{}`.

## [x] Task: `find_project_root` cache doc comment contradicts the code on three points

- **Location**: `src-tauri/src/scanner.rs` (Lines 491-520)
- **Description**: The comment claims the cache is "keyed by canonicalized start dir" — it
  is keyed by the raw `start.to_path_buf()`. It claims entries are "bounded" with a ~512
  cap — the code clears the whole map at that size, a full flush rather than an eviction
  policy. And it claims callers revalidate via the returned path existing —
  `find_project_root` returns the cached value with no existence check, and the scan
  callers use it directly for the displayed `project_path`. Only `build_launch_record`
  revalidates, by canonicalizing. A project directory deleted or renamed mid-session keeps
  showing its stale path until an unrelated flush.
- **Suggested Fix**: Correct the comment; either canonicalize the key or say plainly that
  it is not. Add a cheap `exists()` check on cache hit if stale display paths matter.
- **Status**: **Done.** Doc comment on `project_root_cache` updated to accurately state
  that the cache is keyed by raw start path (not canonicalized), cleared completely on
  overflow past 512 entries, and returns hits without existence checks (with
  `build_launch_record` doing the canonicalization check).

## [x] Task: A disabled feature ships as dead code held alive by `void` suppressions

- **Location**: `src/features/port-map/**` (8 files incl. tests), `src/components/shell/Sidebar.tsx` (Line 51), `src/features/ports/PortsPage.tsx` (Lines 6, 117-123, 143-151), `src/lib/tauri.ts` (`getPortGraph`), `src-tauri/src/lib.rs` (Line 56)
- **Description**: The Port Map was disabled for MVP but every artefact remains: the
  feature directory with its own tests, `MapIcon`, `openMap`, the `onOpenMap` prop threaded
  from `App.tsx`, commented-out JSX, and the `get_port_graph` IPC command plus
  `usePortGraph`. Because `tsconfig.json` sets `noUnusedLocals` / `noUnusedParameters`,
  this compiles only via three `void X; // MVP: preserved` statements — deliberately
  defeating the compiler check that exists to catch exactly this, so the type checker can
  no longer tell which symbols are genuinely orphaned.
- **Suggested Fix**: Delete the feature and recover it from git history when wanted (the
  commented JSX already documents the wiring). If it must stay, put it behind a single
  feature-flag constant so the code is genuinely referenced and the `void` suppressions go.
- **Status**: **Done.** Deleted `src/features/port-map/` feature directory and unrouted
  references, eliminating all `void` suppressions and dead IPC calls.

## [x] Task: `src-tauri/errors.json` is a tracked zero-byte file

- **Location**: `src-tauri/errors.json`
- **Description**: An empty file committed to the repository and referenced by nothing in
  the Rust or TypeScript sources. It reads as an abandoned scaffold for an error catalogue
  and invites a contributor to populate a structure with no consumer.
- **Suggested Fix**: Remove it, or populate and wire it to the `ScanError` / `KillError`
  code strings if a catalogue is genuinely wanted.
- **Status**: **Done.** Removed via `git rm` (commit `ddc5e4f`); nothing referenced it
  since `ScanError` / `KillError` already serialize code and message directly.

## [x] Task: README advertises installers and a feature the build does not produce

- **Location**: `README.md` (Lines 100-112, 9, 42), `src-tauri/tauri.conf.json` (Line 39)
- **Description**: The download table offers `.msi`, `.dmg` (Apple Silicon and Intel) and
  `.deb`, but `bundle.targets` is `["nsis", "appimage"]` — none of those are built, and
  there is no macOS target at all. The tagline promises it "visualizes network topology"
  and the feature list is headed by the port map, the route disabled in this build. Logs
  are described as tracking "connection spikes"; `logger.rs` emits only `started`,
  `stopped` and `conflict`.
- **Suggested Fix**: Align the README with what `tauri.conf.json` produces and what the app
  routes to, or add the missing bundle targets. A release-time check that every advertised
  artifact exists would stop the two drifting again.
- **Status**: **Done.** `README.md` updated: download table matches `bundle.targets`
  (`.exe` NSIS and `.AppImage`, noting macOS builds from source); Port Map section marked as
  temporarily disabled in v0.2; logs description clarified to match actual events emitted.

## [x] Task: `restartPort` returns silently when a port is not restartable

- **Location**: `src/app/usePortPalData.ts` (Line 225)
- **Description**: The guard returns early when `start_cmd` or `project_path` is missing —
  no toast, no error, no state change. The UI normally hides the restart button in this
  case, so the guard is defensive, but any path reaching it (a stale `killedPorts` entry, a
  future caller) produces a button press with no observable consequence.
- **Suggested Fix**: Emit a toast explaining why restart is unavailable, matching how every
  other failure in this hook reports itself.
- **Status**: **Done and tested.** The bare early return now names which half is missing:
  no `start_cmd` gives "Can't restart X: PortPal did not record how it was started", no
  `project_path` gives "…: no project folder was found for it". Falls back to
  `process_name` when there is no project name, matching the surrounding toasts. `label`
  was hoisted since the same expression appeared three times in the function. 3 tests
  added covering the toast firing with `restarting` left empty, each cause producing its
  own message, and the process-name fallback.

## [x] Task: Generated and duplicate directories are untracked but not ignored

- **Location**: `.gitignore`, `portpal/`, `test-results/`, `New assets/`
- **Description**: Directories appear as untracked in `git status`, including Playwright's
  `test-results/` output. Persistent untracked noise trains contributors to ignore
  `git status` — which is how the vulnerable `Test/` copy came within one careless
  `git add -A` of being committed. Contents reviewed: `portpal/ideas.md` is a real backlog
  doc, and largely already delivered — its "plain-English port names with icons and
  tooltips" request is what `src/port-intel/` now implements, and its typography item is
  the Settings font-scale control. `New assets/` is 2.6 MB of design PNGs.
  `test-results/` is purely generated.
- **Suggested Fix**: Add `test-results/` and `playwright-report/` to `.gitignore`. Consider
  moving `portpal/ideas.md` into `docs/` and committing it. Decide whether the design PNGs
  belong in git or outside it.
- **Status**: **Done.** Added `test-results/`, `playwright-report/`, and `New assets/` to
  `.gitignore`.

## [x] Task: A missing `VITE_CSP` would silently disable the meta CSP

- **Location**: `index.html` (Line 7), `.env` (Line 16)
- **Description**: The policy is injected via a Vite placeholder in the meta tag. If the
  variable is absent for a mode, Vite leaves the literal placeholder in the output;
  browsers discard an unparseable policy, so the page renders with **no meta CSP** and no
  runtime error. The packaged app is still covered by `app.security.csp`, but
  `vite preview` and the Playwright runs would be unprotected with no signal. All three
  `.env` files currently define it, so this is latent rather than active.
- **Suggested Fix**: Add a build-time assertion (a small Vite plugin, or a check in
  `beforeBuildCommand`) that fails the build when the emitted `index.html` still contains
  the unreplaced placeholder.
- **Status**: **Done.** Added `assertCspReplaced(mode)` plugin to `vite.config.ts`. It
  asserts non-empty `VITE_CSP` in `configResolved` and throws during `transformIndexHtml`
  if the literal `%VITE_CSP%` token remains unreplaced.

## [x] Task: Minor implementation smells

- **Location**: `src-tauri/src/logger.rs` (Line 40), `src-tauri/src/scanner.rs` (Line 170), `src/components/ui/Sparkline.tsx` (Lines 123-127), `src/features/traffic/TrafficPage.tsx` (Line 101)
- **Description**: (a) `PortTraffic::push` trims with `samples.remove(0)`, an O(n) shift
  where a `VecDeque` is the natural fit. (b) `validate_kill` normalises names with
  `trim_end_matches(".exe")`, which strips *repeated* suffixes where `strip_suffix` is
  intended — harmless today but a surprising primitive inside a security guard.
  (c) `Sparkline` maps values so the bottom of a 1.5px stroke is clipped at the baseline.
  (d) TrafficPage's "Peak (Session)" sums each port's individual peak — the sum of maxima
  rather than the maximum of sums, a number never actually observed at any instant.
- **Suggested Fix**: (a) `VecDeque` + `pop_front`. (b) `strip_suffix(".exe")` with a
  fallback, matching the existing `program_basename_allowed`. (c) Inset the y-range by half
  the stroke width. (d) Relabel as "Sum of peaks", or compute the true peak from
  time-aligned samples once the `get_traffic` merge is fixed.
- **Status**: **Done.** (a) `PortTraffic.samples` is now a `VecDeque` with
  `push_back` + `pop_front`. (b) `validate_kill` uses
  `strip_suffix(".exe").unwrap_or(&name)`, same idiom as the other two call sites.
  (c) `Sparkline` maps values into `[halfStroke, height - halfStroke]`. (d) The
  summary now reads "Sum of peaks" with a comment explaining why; test updated.
