# IPC capability surface

`src-tauri/capabilities/default.json` decides which **core plugin** commands the
webview may invoke. PortPal's own commands (`get_ports`, `kill_process`,
`restart_process`, `get_port_events`, `get_port_traffic`) are app commands
registered in `lib.rs`'s `invoke_handler` and are *not* ACL-gated — the
capability file is about `plugin:window|…`, `plugin:event|…` and friends.

## Why this file is an exact list

The capability used to grant `core:default` **and** six explicit
`core:window:allow-*` permissions. `core:default` is the aggregate of
`core:app:default`, `core:event:default`, `core:image:default`,
`core:menu:default`, `core:path:default`, `core:resources:default`,
`core:tray:default`, `core:webview:default` and `core:window:default` — roughly
seventy commands, including every window/monitor getter, path resolution, the
resource table and tray/menu construction. None of it was called. The six
explicit entries documented an intent the file did not enforce.

That matters more here than in most apps: this webview can already ask the
backend to terminate a process, so it is the one place where *unused* reachable
capabilities are pure downside. The list is now one permission per caller.

## What is granted, and who calls it

| Permission | Caller |
|---|---|
| `core:event:allow-listen` | `src/lib/tauri.ts` — `listen()` for `ports-updated`, `port-events`, `scan-degraded`, `scan-recovered` |
| `core:event:allow-unlisten` | the `unlisten()` each `listen()` returns, called from `usePortPalData`'s effect cleanup |
| `core:window:allow-minimize` | `Titlebar.tsx` minimize button |
| `core:window:allow-close` | `Titlebar.tsx` close button (the backend turns close into hide-to-tray) |
| `core:window:allow-toggle-maximize` | `Titlebar.tsx` maximize button |
| `core:window:allow-is-maximized`, `core:window:allow-maximize`, `core:window:allow-unmaximize` | `Titlebar.tsx`'s fallback path when `toggleMaximize` fails |
| `core:window:allow-start-dragging` | Tauri's injected `drag.js`, on mousedown over `data-tauri-drag-region` |
| `core:window:allow-internal-toggle-maximize` | the same script, on double click over that region |
| `core:webview:allow-internal-toggle-devtools` | Tauri's injected `toggle-devtools.js` (Ctrl/Cmd+Shift+I) |

Two entries are worth spelling out:

- **`allow-start-dragging` is not part of `core:window:default`.** The frameless
  window's header carries `data-tauri-drag-region`, and Tauri's injected
  `drag.js` invokes `plugin:window|start_dragging` for it — a command the
  aggregate default never granted. Dragging the window by its titlebar was
  therefore denied at runtime for as long as the capability relied on
  `core:default`; listing it explicitly is what makes the affordance work.
- **`allow-internal-toggle-devtools` costs nothing in a release build.** Both the
  injected hotkey script and the `internal_toggle_devtools` command are
  `#[cfg(any(debug_assertions, feature = "devtools"))]` in the `tauri` crate, so
  the permission is only reachable from a debug build.

Not granted, and deliberately: `core:event:allow-emit` / `allow-emit-to`
(nothing in the webview emits), every window/monitor getter beyond
`is_maximized`, `core:path:*`, `core:resources:*`, `core:tray:*`, `core:menu:*`
(the tray and its menu are built in Rust, where the ACL does not apply),
`core:image:*`, `core:app:*` metadata, and the rest of `core:webview:*`.

## Adding a permission

1. Add the code that calls the API first, then the single `allow-*` permission it
   needs — never an aggregate `:default` set.
2. Update the table above and `EXPECTED_PERMISSIONS` in
   `src/test/capabilities.test.ts`, which asserts the granted set exactly and
   fails on any aggregate. The test is the re-audit gate: a new API cannot land
   without touching it.
3. Run `npm run tauri dev` and exercise the new call. A missing permission is
   **silent in the UI** — the `invoke` promise rejects and the backend logs the
   denial, which is easy to miss behind a `catch`.

## Verifying by hand

`npx vitest run src/test/capabilities.test.ts` covers the list itself. The
runtime behaviour needs the real app (`npm run tauri dev`):

- drag the window by its titlebar — it moves (this is the `start_dragging` path);
- double-click the titlebar, and use the three titlebar buttons;
- confirm the ports table populates and updates every ~2s (the `listen` path);
- Ctrl+Shift+I opens devtools in a dev build.
