import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolveDevServerExposure } from "./dev/devServerHost";

// Fail the build if the %VITE_CSP% placeholder in index.html was not replaced.
// A missing VITE_CSP leaves the literal placeholder text in the output, which
// browsers ignore as an invalid policy — silently dropping meta CSP protection
// in `vite preview` and Playwright runs. All three .env files currently define
// it, so this is a latent-risk guard, not an active fix.
function assertCspReplaced(mode: string): Plugin {
  return {
    name: "assert-csp-replaced",
    // Fail fast with a clear message when VITE_CSP is missing for this mode,
    // before Vite emits an index.html carrying the unreplaced placeholder.
    configResolved() {
      // "." resolves to the project root (cwd) when Vite runs; avoids a
      // `process` reference (no @types/node in this repo).
      const env = loadEnv(mode, ".", "");
      if (!env.VITE_CSP?.trim()) {
        throw new Error(
          `Build failed: VITE_CSP is missing or empty for mode "${mode}". ` +
            "Define it in .env / .env.development / .env.production.",
        );
      }
    },
    transformIndexHtml(html) {
      if (html.includes("%VITE_CSP%")) {
        throw new Error(
          "Build failed: %VITE_CSP% placeholder was not replaced in index.html. " +
            "Define a non-empty VITE_CSP in .env / .env.development / .env.production.",
        );
      }
      return html;
    },
  };
}

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
export default defineConfig(async ({ mode }) => ({
  plugins: [react(), assertCspReplaced(mode)],

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
