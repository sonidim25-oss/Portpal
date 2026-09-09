# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PortPal is a Tauri 2 desktop app (React + TypeScript frontend, Rust backend) that lists listening TCP ports with their owning process and lets you kill or restart them.

## Commands

`package.json` only defines `dev`, `build`, `preview`, and `tauri`. The commands you actually need are not all in there:

- `npm run tauri dev` — the real dev loop. `npm run dev` alone is Vite only; Tauri IPC (`invoke`) is unavailable in that mode.
- `npm run build` — `tsc && vite build`. This is the typecheck gate (see tsconfig below).
- `npx tauri build --no-bundle` — Windows portable exe.
- `npx tauri build --bundles appimage` — Linux portable.

There are no tests, no linter, and no formatter in this repo.

**Do not run builds or launch the app unprompted.** Make the edit and stop; the user verifies. Run a build only when asked to.

## TypeScript

`tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`. A leftover import or an unused function parameter is a **build failure**, not a warning. Clean up imports when removing code.

## Rust / Tauri

**`src-tauri/src/main.rs` and `src-tauri/src/lib.rs` are near-duplicate entrypoints.** Both declare `mod scanner/tray/connections/logger`, both re-define the same `#[tauri::command]` functions, and both build their own `tauri::Builder`. Any new IPC command must be added to the `invoke_handler` in **both files** or the bin and lib targets diverge. `main.rs` is the binary that actually ships.

Known divergences (leave alone unless asked to fix): `lib.rs` has an extra `greet` command, and `lib.rs` registers `tauri_plugin_opener` and `tauri_plugin_dialog` while `main.rs` registers neither.

New window or plugin APIs also need a permission added to `src-tauri/capabilities/default.json`, or the IPC call is silently denied at runtime.

Other things that surprise people:

- **Closing the window hides it.** `on_window_event` calls `prevent_close()` + `hide()`; the process only exits via the tray menu. A "closed" dev window is still running.
- `scanner.rs` and `connections.rs` shell out to `netstat -ano` (Windows) / `lsof` (macOS, Linux) / `ss` (Linux) and `.expect(...)` on failure, so a missing binary panics.
- Tray icons are `include_bytes!`-embedded from `src-tauri/icons/tray-{green,yellow,red}.png` — renaming those files is a compile error.
- `tray.rs` runs a 2s polling thread that emits `ports-updated`, `port-events`, and `tray-state-changed` to the frontend.
- The window is frameless (`"decorations": false`); the titlebar controls are React UI calling `getCurrentWindow()`.

## Vite

Dev server is pinned to port 1420 with `strictPort: true` — dev fails hard if 1420 is taken. `TAURI_DEV_HOST` optionally switches Vite to a network host with HMR on ws:1421.

## Git

`origin` is the user's fork (`sonidim25-oss/Portpal`); `upstream` is `wisher567/Portpal`. Work on a feature branch and open a PR against `origin` — do not commit directly to `main`.

`git status` may show `src-tauri/Cargo.toml` as modified with an empty `git diff`; that is a CRLF artifact, not a real change.
