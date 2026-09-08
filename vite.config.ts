import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveDevServerExposure } from "./dev/devServerHost";

// Security: the dev frontend can invoke privileged Tauri IPC (kill/restart), so it
// binds to loopback by default. `TAURI_DEV_HOST` alone (which `tauri dev` sets to the
// LAN IP) is NOT enough to expose it — the developer must also set PORTPAL_ALLOW_LAN=1
// (or TAURI_DEV_LAN=1). See docs/dev-security.md and dev/devServerHost.ts.
// @ts-expect-error process is a nodejs global
const exposure = resolveDevServerExposure(process.env);

if (exposure.warning) {
  console.warn(exposure.warning);
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // 127.0.0.1 unless LAN mode was explicitly opted into.
    host: exposure.host,
    // undefined = Vite's default (local) HMR; only set when LAN mode is on.
    hmr: exposure.hmr,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
