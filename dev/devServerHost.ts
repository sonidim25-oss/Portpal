/**
 * Dev-server network exposure policy.
 *
 * Security: the Vite dev frontend can invoke privileged Tauri IPC (kill/restart).
 * Binding it to a LAN address hands that debugging surface to every neighbour on
 * the network, so LAN binding must never happen implicitly. Tauri sets
 * `TAURI_DEV_HOST` to the machine's LAN IP for mobile/LAN development; on its own
 * that is NOT treated as consent. The developer must also opt in explicitly with
 * `PORTPAL_ALLOW_LAN=1` (or `TAURI_DEV_LAN=1`). Otherwise the server and HMR are
 * pinned to loopback.
 */

/** Loopback address the dev server binds to unless LAN mode is explicitly enabled. */
export const LOOPBACK_HOST = "127.0.0.1";

/** HMR websocket port used when LAN mode is enabled (matches Tauri's mobile setup). */
export const LAN_HMR_PORT = 1421;

/** Environment variables that opt in to LAN exposure, in precedence order. */
export const LAN_OPT_IN_VARS = ["PORTPAL_ALLOW_LAN", "TAURI_DEV_LAN"] as const;

export type DevServerEnv = Record<string, string | undefined>;

export interface DevServerHmr {
  protocol: "ws";
  host: string;
  port: number;
}

export interface DevServerExposure {
  /** Value for `server.host`: loopback unless LAN mode is explicitly enabled. */
  host: string;
  /** Value for `server.hmr`: `undefined` (Vite default, local) unless LAN mode is on. */
  hmr: DevServerHmr | undefined;
  /** True only when a LAN host is present AND an opt-in flag is set. */
  lanEnabled: boolean;
  /** Loud warning to print at config load when LAN mode is on; `null` otherwise. */
  warning: string | null;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/** True when the developer explicitly asked for LAN exposure. */
export function isLanOptIn(env: DevServerEnv): boolean {
  return LAN_OPT_IN_VARS.some((name) => isTruthyFlag(env[name]));
}

/**
 * Resolve the dev-server binding policy from the environment.
 *
 * Default (including when `TAURI_DEV_HOST` is set by `tauri dev`/`tauri android dev`):
 * loopback host, default local HMR. LAN binding requires both a host and an opt-in flag.
 */
export function resolveDevServerExposure(env: DevServerEnv): DevServerExposure {
  const lanHost = env.TAURI_DEV_HOST?.trim();
  const lanEnabled = Boolean(lanHost) && isLanOptIn(env);

  if (!lanEnabled || !lanHost) {
    return { host: LOOPBACK_HOST, hmr: undefined, lanEnabled: false, warning: null };
  }

  return {
    host: lanHost,
    hmr: { protocol: "ws", host: lanHost, port: LAN_HMR_PORT },
    lanEnabled: true,
    warning: [
      "",
      "  ############################################################",
      "  # PortPal dev server is exposed on the LAN (opt-in)        #",
      "  ############################################################",
      `  #  App:  http://${lanHost}:1420`,
      `  #  HMR:  ws://${lanHost}:${LAN_HMR_PORT}`,
      "  #",
      "  #  Anyone on this network can load the dev frontend, which",
      "  #  can invoke privileged kill/restart IPC. Use only on a",
      "  #  trusted network, and unset PORTPAL_ALLOW_LAN/TAURI_DEV_LAN",
      "  #  when you are done.",
      "  ############################################################",
      "",
    ].join("\n"),
  };
}
