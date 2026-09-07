# Kill-policy worker report

Task: `task_3479156f5f6d`; dispatch: `ctx_4c5fdf7f68f3`.

Implemented in the existing TEST-FIX worktree without a branch/worktree change or reverting other workers. The narrow boundary is `scanner::kill_pid`, shared by both IPC wrappers and the trusted-restart kill step. Previously any `u32` reached taskkill/libc; now reserved and signed-overflow IDs, absent listeners, critical names/ports, and changed/missing process metadata reject before signaling with serializable code/message errors. Ordinary observed development listeners remain allowed.

Frontend changes add a modal confirmation for Kill All and protected single kills, retain the first row for each PID, skip busy/protected PIDs, dispatch sequentially, and report aggregate results. The hook synchronously prevents concurrent duplicate PID requests and displays structured backend rejection messages without removing live rows. Protected processes remain blocked even after confirmation; no override was added to the PID-only IPC. The old no-confirm spec is explicitly superseded in `docs/kill-policy.md` because of data-loss/DoS risk.

## Validation evidence

- RED: updated PortsPage/App integration tests failed in three cases because the original implementation immediately dispatched and had no alertdialog. Rust policy tests initially failed to compile because no validator existed.
- GREEN: `npm run test:run -- src/app/usePortPalData.test.tsx src/features/ports/PortsPage.test.tsx src/App.integration.test.tsx src/components/shell/Titlebar.test.tsx` — 48 tests passed across four files.
- GREEN: `cargo test --manifest-path src-tauri/Cargo.toml kill_policy --lib` — both kill-policy tests passed; subsequent full library run includes their expanded reserved-PID boundary assertions.
- GREEN: `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 45 tests passed, including trusted-launch validation/restart regressions.
- GREEN: `npx tsc --noEmit` and `git diff --check` — no errors (Git emitted line-ending notices).
- GREEN: `cargo check --manifest-path src-tauri/Cargo.toml --bins` — both Rust entry points compile; existing unused-import/dead-code warnings remain.
- Existing Rust warning: unused `tauri::Manager` import in lib.rs; left unchanged.

Review checked both IPC entry points, trusted restart, all active single/bulk callers, multiple ports for one PID, hidden protected siblings, rejected operation state, keyboard cancellation/traversal, and the Unix signed-PID representation and delayed SIGKILL path. Titlebar was not edited; restart still sends only port/pid and never cmd/cwd.

## Scope and remaining limits

Worker-owned paths: `src-tauri/src/scanner.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src/app/killPolicy.ts`, `src/app/usePortPalData.ts`, `src/app/usePortPalData.test.tsx`, `src/features/ports/KillConfirmation.tsx`, `src/features/ports/PortsPage.tsx`, `src/features/ports/PortsPage.test.tsx`, `src/features/ports/ports.css`, `src/App.integration.test.tsx`, and the two kill-policy documents. Several already contained dirty changes; only kill-policy hunks were edited. Other workers/coordinator changed and committed shared files during execution, so the final HEAD-relative diff may not include every worker-owned hunk.

Windows-host checks passed. Native Linux/macOS runtime execution and a real Tauri desktop manual walkthrough were not performed; automated tests exercise the requested unknown-PID error presentation, duplicate-PID single dispatch, explicit Postgres warning, and safe cancellation without killing real services. Unix signal results now propagate and delayed escalation compares start times, but discovery/signaling still have a small PID-reuse race because the application uses numeric PIDs rather than platform process handles/pidfds. Additional protected ports can be configured only in the host environment (`PORTPAL_CRITICAL_PORTS`), not from the webview.
