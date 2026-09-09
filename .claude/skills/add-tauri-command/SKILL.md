---
name: add-tauri-command
description: Add a new Tauri IPC command to PortPal end to end — Rust implementation, registration in BOTH main.rs and lib.rs, capability permissions, and the frontend invoke() call. Use whenever a new #[tauri::command] is being added or an existing one is renamed or removed.
---

Adding an IPC command to PortPal touches four places. Missing any one of them fails silently or diverges between the bin and lib targets.

## 1. Implement the command

Put the function in the module it belongs to — `src-tauri/src/scanner.rs` (port enumeration), `connections.rs` (socket/connection parsing), `logger.rs` (event history), or `tray.rs` (tray state). Only add a new module if none fit.

The `#[tauri::command]` wrapper itself lives in the entrypoint files, not the module — match the existing pattern there: a thin `#[tauri::command] fn name(...) -> T { module::impl(...) }`.

Return a `Result<T, String>` for anything that can fail. Do not add new `.expect()` calls — the existing ones in `scanner.rs` are a known liability, not a pattern to copy.

## 2. Register in BOTH entrypoints

`src-tauri/src/main.rs` and `src-tauri/src/lib.rs` each declare their own modules and their own `tauri::Builder`. Add the command function **and** its `invoke_handler` entry to both:

```rust
.invoke_handler(tauri::generate_handler![
    get_ports,
    kill_process,
    // ... existing commands
    your_new_command,
])
```

`main.rs` is the binary that ships, so an entry missing there means the command does not exist at runtime no matter what `lib.rs` says. Leave the existing `greet`-in-lib-only and plugin-registration differences alone unless the task is specifically to fix them.

## 3. Add capability permissions if needed

If the command uses a Tauri core or plugin API beyond what is already granted, add the permission to `src-tauri/capabilities/default.json`. Currently granted: `core:default`, `opener:default`, `core:window:allow-minimize`, `core:window:allow-maximize`, `core:window:allow-close`.

A missing permission is denied silently — the frontend `invoke()` rejects with a permission error rather than the command failing visibly.

## 4. Call it from the frontend

In `src/App.tsx` or `src/PortMap.tsx`:

```ts
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<ReturnType>("your_new_command", { argName: value });
```

The command name is the Rust function name verbatim. Argument keys are camelCase on the TS side and snake_case in Rust — Tauri converts them.

Type the return value. Do not leave an unused import or an unused destructured field behind: `tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`, so that fails `npm run build`.

## 5. Report, don't verify

State which files you changed and that both entrypoints were updated. Do not run `npm run build` or `npm run tauri dev` unless asked.
