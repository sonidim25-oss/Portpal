# Dependency audit — cadence and policy

Monthly, lightweight, no secrets, no auto-merge. Findings are reviewed by a
human; bumps land as normal PRs so the Tauri build stays green.

## What runs, monthly

- GitHub Actions: `.github/workflows/audit.yml` (cron, 1st of month + manual
  `workflow_dispatch`).
  - `npm audit --audit-level=moderate` (frontend).
  - `cargo audit` in `src-tauri/` (RustSec advisories for `Cargo.lock`).
- Locally: `npm run audit` (npm) and `npm run audit:rust` (requires
  `cargo install cargo audit`; read-only, changes nothing).

## 2026-09 review (dep-dedupe + age check)

Direct Rust deps before: `tauri 2`, `tauri-plugin-opener 2`, `serde 1`,
`serde_json 1`, `regex 1.10`, `tauri-plugin-dialog 2`, `window-vibrancy 0.5`,
`once_cell 1.19`, `sysinfo 0.30`, `lazy_static 1.4`.

After: same list minus `once_cell` and `lazy_static`. Both singletons
(`LOGGER` in `src-tauri/src/logger.rs`, `TRUSTED` in
`src-tauri/src/scanner.rs`) now use `std::sync::LazyLock` (stable since Rust
1.80; toolchain here is 1.98, edition 2021 — no MSRV concern). `lazy_static`
is fully gone from `Cargo.lock`; `once_cell` remains only transitively
(tauri/tray-icon/tempfile dependency chains) and is no longer our direct dep.

Resolved versions at review (all current for their pinned ranges):
`sysinfo 0.30.13`, `regex 1.12.3`, `serde 1.0.228`, `serde_json 1.0.149`,
`tempfile 3.27.0`, `libc 0.2.184`, `tauri 2.10.3`.

### sysinfo: bump deferred, with reason

Latest upstream is 0.39.x, but 0.31.0 changed the process API we rely on:
`refresh_processes()` now takes `(ProcessesToUpdate, bool)`,
`System::process(Pid)` / `refresh_process` were removed, and
`process.name()` / `process.cmd()` moved to `OsStr`/`OsString`, which would
force rewrites of `scan_ports`, `restart_trusted`, and `build_launch_record`
(`&[String]` argv handling). 0.30.13 is the latest 0.30.x patch, shows no
deprecation warnings under `cargo check`, and needs no API migration — so we
stay pinned and let the monthly `cargo audit` flag any future RustSec advisory
before reconsidering the migration.

### Not bumped, by policy

Tauri 2.x, React 19, and edition 2021 are out of scope for routine audits;
major upgrades need a dedicated, tested change, never an automated bump.

## Triage rules

1. `cargo audit` / `npm audit` critical or high with a fix available → patch PR
   within the cycle; re-run `cargo check`, `cargo test`, `npm run test:run`.
2. Advisory with no compatible fix (e.g. needs a breaking major) → file an
   issue, note the blocker here, keep the monthly job green.
3. `cargo audit` failure from a stale advisory DB is infra noise, not a code
   gate — the release workflow (`build.yml`) is unaffected.
