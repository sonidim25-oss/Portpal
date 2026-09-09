# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PortPal is a Tauri 2 desktop app (React + TypeScript frontend, Rust backend) that lists listening TCP ports with their owning process and lets you kill or restart them.

## Commands

- `npm run tauri dev` — the real dev loop. `npm run dev` alone is Vite only; Tauri IPC (`invoke`) is unavailable in that mode.
- `npm run build` — `tsc && vite build`. This is the typecheck gate (see tsconfig below).
- `npm run test:run` — Vitest once. `npm test` watches.
- `cd src-tauri && cargo test` — the Rust suite.
- `npm run test:e2e` — Playwright against `npm run preview`.
- `npm run audit` / `npm run audit:rust` — dependency audits.
- `npx tauri build --no-bundle` — Windows portable exe.
- `npx tauri build --bundles appimage` — Linux portable.

**A green Vitest run does not mean the build passes.** Vitest transpiles without
typechecking, so a type error shows up only in `npm run build` (`tsc && vite build`).
This has already broken `main` once. Run `npx tsc --noEmit` before assuming frontend
work is sound.

There is no linter and no formatter in this repo.

**Do not run builds or launch the app unprompted.** Make the edit and stop; the user verifies. Run a build only when asked to.

## TypeScript

`tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`. A leftover import or an unused function parameter is a **build failure**, not a warning. Clean up imports when removing code.

## Rust / Tauri

**There is one entrypoint: `src-tauri/src/lib.rs`.** It declares the modules, defines
every `#[tauri::command]`, and builds the only `tauri::Builder`.
`src-tauri/src/main.rs` is a 10-line wrapper that calls `portpal_lib::run()` and
nothing else — a new IPC command goes in `lib.rs` alone.

This used to be two near-duplicate entrypoints that each built their own `Builder`,
requiring every command to be registered twice; a fix could land in one and miss the
shipped binary. That is gone, along with the `greet` command and the
`tauri_plugin_opener` / `tauri_plugin_dialog` registrations. If you find guidance
elsewhere about "adding a command to both files", it is out of date.

New window or plugin APIs also need a permission added to `src-tauri/capabilities/default.json`, or the IPC call is silently denied at runtime. That file is an **exact** list — one `allow-*` per caller, no aggregate `:default` sets — enforced by `src/test/capabilities.test.ts`. See `docs/ipc-capabilities.md`.

Other things that surprise people:

- **Closing the window hides it.** `on_window_event` calls `prevent_close()` + `hide()`; the process only exits via the tray menu. A "closed" dev window is still running.
- `scanner.rs` and `connections.rs` shell out to `netstat -ano` (Windows) / `lsof`
  (macOS, Linux) / `ss` (Linux). **These paths never panic, deliberately.** A missing
  or failing tool returns a typed `ScanError`, and a failed scan is never flattened
  into an empty port list — "nothing is listening" and "the scan did not run" are
  different claims and the kill guards depend on the difference. Preserve that when
  editing; do not introduce `.expect`/`unwrap` there.
- **Never match the localized text of a scan tool.** Windows translates `netstat`'s
  State column, so matching `LISTENING`/`ESTABLISHED` reported zero ports on every
  non-English install. Rows are parsed structurally by `netaddr::parse_netstat_tcp_row`.
- Tray icons are `include_bytes!`-embedded from `src-tauri/icons/tray-{green,yellow,red}.png` — renaming those files is a compile error.
- `tray.rs` runs a 2s polling thread that emits `ports-updated`, `port-events`,
  `tray-state-changed`, `scan-degraded`, `scan-recovered`, and `scan-completed` to the
  frontend. **`ports-updated` fires only when the port list actually differs**, so it is
  not a scan clock — `scan-completed` fires on every successful tick and is what the
  sidebar's "Last scan" reads.
- The window is frameless (`"decorations": false`); the titlebar controls are React UI calling `getCurrentWindow()`.

## Vite

Dev server is pinned to port 1420 with `strictPort: true` — dev fails hard if 1420 is
taken. It binds to loopback by default. `TAURI_DEV_HOST` alone does **not** expose it
on the LAN: the dev frontend can invoke privileged kill/restart IPC, so LAN binding
also requires an explicit `PORTPAL_ALLOW_LAN=1` (or `TAURI_DEV_LAN=1`), which then
serves HMR on ws:1421 and prints a warning. See `dev/devServerHost.ts`.

## Git

`origin` is the user's fork (`sonidim25-oss/Portpal`); `upstream` is `wisher567/Portpal`. Work on a feature branch and open a PR against `origin` — do not commit directly to `main`.

`git status` may show `src-tauri/Cargo.toml` as modified with an empty `git diff`; that is a CRLF artifact, not a real change.
