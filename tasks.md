# PortPal — Code Review Task List

Full-codebase review: `src-tauri/src/**` (Rust backend), `src/**` (React/TypeScript
frontend), `dev/`, and build/security configuration (`vite.config.ts`,
`tauri.conf.json`, `capabilities/`, `.env*`, `index.html`).

**14 tasks** — all MEDIUM, all open.

Status legend: `[ ]` open · `[x]` done · `[~]` resolved outside this work

---

## Summary

| Priority | Total | Done | Open |
|---|---|---|---|
| MEDIUM | 14 | 0 | 14 |
| **Total** | **14** | **0** | **14** |

General note: the remaining findings cluster in platform assumptions, frontend
destructive-action UX, and duplicated policy tables.

---

# MEDIUM

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

## [x] Task: Normal multi-worker servers are reported as port conflicts

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

## [x] Task: Linux silently requires two tools; only one is covered by preflight

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

## [x] Task: The packaged desktop app fetches webfonts from Google at runtime

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

## [x] Task: No React error boundary in a frameless, close-intercepting window

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

## [x] Task: Tauri capability grants `core:default` rather than the permissions used

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

## [x] Task: Killed endpoints without a launch record vanish with no STOPPED row

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

## [x] Task: `observedAt` accumulates entries for ports that no longer exist

- **Location**: `src/app/usePortPalData.ts` (Lines 88, 160)
- **Description**: Both `refreshEvents` and the `onPortEvents` stream merge into
  `observedAt` by spreading the previous map, and nothing ever removes a key. The backend
  deliberately purges `first_seen` and `traffic` for stopped endpoints (`logger.rs`
  Lines 160-164) to prevent exactly this, but the frontend mirror grows without bound for
  the life of the window — and the window is never closed, only hidden.
- **Suggested Fix**: Prune `observedAt` in the `onPortsUpdated` handler against the live
  port set, as `killedPorts` already is (Lines 143-154).
