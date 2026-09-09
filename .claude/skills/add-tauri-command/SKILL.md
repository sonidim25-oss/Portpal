---
name: add-tauri-command
description: Use when adding, renaming, or removing a Tauri IPC command in PortPal across Rust registration, the typed frontend gateway, and exact core or plugin capability permissions.
---

# Add a Tauri Command

PortPal has one Tauri entrypoint: `src-tauri/src/lib.rs`. Its
`src-tauri/src/main.rs` is only a wrapper that calls `portpal_lib::run()`.
Never add command wrappers, modules, builders, or registrations to `main.rs`.

## Backend implementation and registration

Put reusable backend logic in the module that owns it:

- `scanner.rs` for port enumeration and process lifecycle operations
- `connections.rs` for socket and connection data
- `logger.rs` for event and traffic history
- `tray.rs` for tray behavior

Keep the `#[tauri::command]` wrapper thin and define it in
`src-tauri/src/lib.rs`. Blocking scans, process operations, and filesystem work
must use the existing `run_off_thread` pattern instead of running inline on the
IPC dispatcher.

Register the wrapper once in `lib.rs`:

```rust
#[tauri::command]
async fn your_new_command(arg: String) -> Result<ReturnType, String> {
    run_off_thread(move || module::implementation(arg))
        .await
        .unwrap_or_else(Err)
}

// Inside portpal_lib::run()
.invoke_handler(tauri::generate_handler![
    get_ports,
    kill_process,
    restart_process,
    get_port_events,
    get_port_traffic,
    your_new_command,
])
```

Match the existing typed error when the owning module exposes one. Do not turn
a scan failure into an empty result or add `.expect()`/`.unwrap()` to a runtime
scan, kill, restart, listener-registration, or lock path.

When renaming or removing a command, update or remove both its wrapper and its
single `generate_handler!` entry in `lib.rs`. Confirm `main.rs` remains the
unchanged wrapper.

## Frontend gateway

Add the typed method to `PortPalGateway` and its `invoke()` implementation in
`src/lib/tauri.ts`. Components and hooks consume that gateway rather than
importing `invoke` directly.

```ts
export interface PortPalGateway {
  yourNewCommand(arg: string): Promise<ReturnType>;
}

export const tauriPortPalGateway: PortPalGateway = {
  yourNewCommand: (arg) =>
    invoke<ReturnType>('your_new_command', { arg }),
};
```

The command name matches the Rust wrapper. Tauri command arguments use
camelCase keys in TypeScript for snake_case Rust parameters. Update gateway
mocks and focused tests for every added, renamed, or removed method.

## Capability permissions

PortPal's own commands in `generate_handler!` are not listed in
`src-tauri/capabilities/default.json`. That file controls Tauri core and plugin
APIs used by the webview.

If the frontend also starts calling a new core or plugin API, read
`docs/ipc-capabilities.md`, add only its exact `allow-*` permission, and update
the exact expected set in `src/test/capabilities.test.ts`. Never add an
aggregate `:default` permission set.

## Verification

Run checks that match the change:

```powershell
cd src-tauri
cargo test
cd ..
npx vitest run src/test/capabilities.test.ts
npx tsc --noEmit
```

Run the focused frontend test for the gateway consumer as well. If runtime
permission behavior changed, use `npm run tauri dev` and exercise the call;
capability denials can otherwise look silent in the UI.

Before finishing, verify the obsolete second-entrypoint pattern was not
reintroduced:

```powershell
rg -n "tauri::Builder|generate_handler|#\[tauri::command\]" src-tauri/src/main.rs
```

The expected result is no matches.
