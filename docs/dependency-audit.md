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

### Removed: `tauri-plugin-opener` and `tauri-plugin-dialog` (capability audit)

Both plugins were registered in `src-tauri/src/lib.rs` and carried in
`Cargo.toml` / `package.json`, and `opener:default` was granted in
`src-tauri/capabilities/default.json` — but nothing called them. A repo-wide
grep found zero imports of `@tauri-apps/plugin-opener` or
`@tauri-apps/plugin-dialog` and no `openUrl` / `openPath` /
`revealItemInDir` / `message` / `ask` / `confirm` / `open` / `save` call
sites in `src/`. The kill confirmation
(`src/features/ports/KillConfirmation.tsx`) is a custom HTML `alertdialog`,
not the Tauri dialog plugin.

`opener:default` in particular is a privilege the app never used: it lets the
webview hand arbitrary URLs and filesystem paths to the OS shell handler. That
is exactly the primitive a frontend XSS wants, so it was dead attack surface,
not dead code. Both plugins and the capability entry are gone; `Cargo.lock`
lost 543 lines of transitive dependencies. The capability now grants only
`core:default` plus the six `core:window:*` permissions the custom titlebar
needs (`minimize`, `maximize`, `unmaximize`, `toggle-maximize`,
`is-maximized`, `close`).

If a genuine need for either plugin appears later, re-add the granular
permission (`opener:allow-open-url` scoped to specific domains,
`dialog:allow-message`) rather than the `:default` permission set, and record
the call site here.

### Content-Security-Policy

There was no CSP at all: no `<meta http-equiv>` in `index.html` and no
`app.security.csp` in `tauri.conf.json`. Both now exist and are kept in sync.

- Production / preview: `default-src 'self'` with no inline script or style
  and no remote origins except the two webfont hosts noted under "Known gap"
  below. `connect-src` keeps `ipc:` and
  `http://ipc.localhost` (Tauri v2's IPC origins — Windows and Android use the
  latter); dropping them breaks every `invoke()`.
- Dev: `app.security.devCsp` plus `.env.development` relax `script-src` with
  `'unsafe-inline' 'unsafe-eval'` (the `@vitejs/plugin-react` refresh preamble
  is an inline module script) and `style-src` with `'unsafe-inline'` (Vite
  injects CSS as inline `<style>` in dev), and allow the HMR websocket on
  loopback only (`ws://localhost:1420`, `ws://127.0.0.1:1420`). LAN dev mode
  (`PORTPAL_ALLOW_LAN=1`, see `docs/dev-security.md`) serves HMR from a LAN
  address that this loopback-only `connect-src` blocks on purpose; override it
  in an untracked `.env.development.local` if you deliberately opt in.

The meta tag's value comes from `VITE_CSP` in `.env` / `.env.development` /
`.env.production` via Vite's `%VAR%` HTML replacement, so the dev relaxation
never reaches a production build — `dist/index.html` carries the strict policy.
`frame-ancestors` is deliberately absent from the meta value (browsers ignore
it there and log a console error) and present in the `tauri.conf.json` policy,
which Tauri serves as a real response header.

Verified against the production build in headless Chromium (`vite preview` +
Playwright): title is `PortPal`, the strict policy is present, and there are
zero CSP violations and zero CSP console errors.

#### Known gap: remote webfonts

`src/styles/tokens.css:1` still does
`@import url('https://fonts.googleapis.com/css2?family=Geist&family=JetBrains+Mono')`,
so the CSP has to allow `https://fonts.googleapis.com` in `style-src` and
`https://fonts.gstatic.com` in `font-src`. Those two origins are the **only**
remote hosts the policy permits — remote script, frame, object, and
`connect-src` are all still fully blocked, which is the surface that matters
for a webview RCE.

The remaining cost is privacy and offline behaviour, not code execution: a
desktop app should not phone Google on every launch, and the UI reflows to the
fallback stacks when the machine is offline. The fix is to vendor the woff2
files into `public/fonts/` and swap the `@import` for local `@font-face`
rules; the two origins then come straight back out of the CSP, `.env*`, and
`tauri.conf.json`. That was left out of this pass deliberately — it commits
binary assets and changes rendering, which is a product decision rather than a
capability-audit one. Simply deleting the `@import` is *not* equivalent:
neither Geist nor JetBrains Mono is installed on a stock Windows machine, so
the app would silently fall back to the system sans and Consolas.

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
