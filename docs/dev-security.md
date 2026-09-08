# Dev-server network exposure

The Vite dev frontend is a privileged surface: it can invoke PortPal's Tauri IPC,
including the guarded kill/restart commands. Anyone who can load it in a browser
gets that power, so the dev server must not be reachable from the LAN unless a
developer explicitly asks for it.

## Policy

Implemented in `dev/devServerHost.ts`, consumed by `vite.config.ts`.

| Environment | `server.host` | `server.hmr` |
| --- | --- | --- |
| Nothing set (`npm run dev`) | `127.0.0.1` | Vite default (local) |
| `TAURI_DEV_HOST=192.168.x.x` only (`tauri dev`) | `127.0.0.1` | Vite default (local) |
| `TAURI_DEV_HOST` **and** `PORTPAL_ALLOW_LAN=1` | the LAN IP | `ws://<LAN IP>:1421` |

Key point: `tauri dev` and `tauri android dev` set `TAURI_DEV_HOST` to the
machine's LAN IP on their own. That is **not** treated as consent — previously it
was, which silently published the dev frontend and the HMR websocket to the whole
network. LAN binding now requires a second, deliberate opt-in.

Opt-in flags (either works, values `1`/`true`/`yes`/`on`): `PORTPAL_ALLOW_LAN`,
`TAURI_DEV_LAN`.

The port (1420), `strictPort`, and `devUrl` in `src-tauri/tauri.conf.json`
(`http://localhost:1420`) are unchanged, so desktop `tauri dev`, `npm run preview`,
and the Playwright suite (`http://localhost:1420`) are unaffected.

## Mobile / LAN development

A phone or another machine cannot reach `127.0.0.1`, so the mobile workflow needs
the opt-in:

```sh
# macOS/Linux
PORTPAL_ALLOW_LAN=1 npm run tauri android dev

# PowerShell
$env:PORTPAL_ALLOW_LAN = "1"; npm run tauri android dev
```

In that mode Vite prints a loud banner at config load naming the LAN URL and the
exposed HMR port, and reminding you it is for trusted networks only. Unset the
flag when you are done.

## Verification

- `npx vitest run dev/devServerHost.test.ts` covers the table above.
- Manual: `TAURI_DEV_HOST=192.168.1.42 npm run dev` — Vite reports it is listening
  on `127.0.0.1:1420` only, with no "Network:" address. Adding
  `PORTPAL_ALLOW_LAN=1` prints the warning banner and binds the LAN IP.
