import { describe, expect, it } from "vitest";
import capability from "../../src-tauri/capabilities/default.json";

// The IPC surface this webview is allowed to reach, asserted as an exact set.
//
// PortPal's own commands (get_ports, kill_process, restart_process, …) are app
// commands and are not ACL-gated; everything below is a *core plugin* command,
// which is. The capability used to grant `core:default` — the aggregate of
// app/event/image/menu/path/resources/tray/webview/window defaults, ~70
// commands — alongside six explicit window permissions, so the explicit list
// documented an intent the file did not enforce.
//
// Each entry here has exactly one caller. Keep that true: add a permission only
// together with the code that calls it, and see docs/ipc-capabilities.md.
const EXPECTED_PERMISSIONS = [
  // src/lib/tauri.ts — listen() for ports-updated / port-events /
  // scan-degraded / scan-recovered, and the unlisten() returned by each,
  // called from usePortPalData's effect cleanup. emit/emit_to are NOT granted:
  // nothing in the webview emits to the backend.
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  // src/components/shell/Titlebar.tsx — the frameless window's own controls.
  "core:window:allow-minimize",
  "core:window:allow-maximize",
  "core:window:allow-unmaximize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-is-maximized",
  "core:window:allow-close",
  // Tauri's injected drag.js, for the header's data-tauri-drag-region:
  // start_dragging on mousedown, internal_toggle_maximize on double click.
  // start_dragging is absent from core:window:default, so dragging the
  // frameless window was denied at runtime until it was listed here.
  "core:window:allow-start-dragging",
  "core:window:allow-internal-toggle-maximize",
  // Tauri's injected toggle-devtools.js (Ctrl/Cmd+Shift+I). Both the script and
  // the command are cfg(debug_assertions) / feature = "devtools", so this grants
  // nothing in a release build.
  "core:webview:allow-internal-toggle-devtools",
] as const;

describe("main window capability", () => {
  it("grants exactly the permissions the frontend uses", () => {
    expect([...capability.permissions].sort()).toEqual([...EXPECTED_PERMISSIONS].sort());
  });

  it("grants no aggregate permission set", () => {
    // `core:default` and any `core:<plugin>:default` pull in whole command
    // groups, which is how unused capabilities (path, resources, tray, menu,
    // image, app metadata) end up reachable from the webview in an app whose
    // IPC can kill processes.
    const aggregates = capability.permissions.filter((permission) => permission.endsWith(":default"));
    expect(aggregates).toEqual([]);
  });

  it("is scoped to the main window", () => {
    expect(capability.windows).toEqual(["main"]);
  });
});
