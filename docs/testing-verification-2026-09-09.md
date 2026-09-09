# Testing Verification Report — 2026-09-09

Reproducible test verification report produced in accordance with `docs/superpowers/plans/2026-09-09-testing-gaps-verification.md`.

---

## 1. Verification Summary Table

| Area | Command | Result | Evidence | Limitation / Notes |
|---|---|---|---|---|
| **Rust backend** | `cd src-tauri && cargo test` | **PASS** | 111 passed; 0 failed; 0 ignored; finished in 0.58s | Tested on Windows x86_64; Unix-specific code paths (`scan_unix`, `kill_unix`) are `#[cfg]`-gated. |
| **Frontend** | `npm run test:run` | **PASS** | 18 test files, 208 passed; 0 failed | Vitest v3.2.7 in jsdom environment. |
| **TypeScript** | `npx tsc --noEmit` | **PASS** | Exit code 0, 0 diagnostic errors | Transpile-only check via TypeScript compiler. |
| **E2E** | `npm run test:e2e` | **PASS** | 2 passed in 3.4s (using Chromium project) | Playwright against `vite preview` on port 1420 using deterministic Tauri fixture mock. |

---

## 2. Destructive-Action & Process Lifecycle Coverage

### Rust Backend Tests (`src-tauri/src/scanner.rs`)

- **Reserved PIDs**:
  - `scanner::tests::reserved_pids_are_zero_and_one_everywhere`: Asserts PIDs 0 and 1 are recognized as reserved on all platforms.
  - `scanner::tests::kill_rejects_reserved_pids_before_anything_else`: Rejects kill requests targeting reserved PIDs before evaluating scan data.
  - `scanner::tests::kill_policy_rejects_unknown_and_reserved_pids`: Verifies error code `"invalid_pid"` for 0, 1, `u32::MAX`, and `i32::MAX as u32 + 1`.
  - `scanner::tests::a_pid_one_listener_is_listed_but_not_killable`: Enforces PID 1 listeners remain visible in scans but unkillable.

- **Critical Infrastructure & Protected Services**:
  - `scanner::tests::kill_policy_rejects_critical_names_and_any_protected_listener`: Rejects kills targeting protected names (e.g. `system`, `svchost.exe`, `lsass`, `postgres`, `redis-server`, `mysqld`, `mongod`) and protected infrastructure ports (`5432`).
  - `scanner::tests::kill_policy_rejects_a_critical_listener_even_when_another_pid_shares_the_port`: Guarantees a kill on a critical process (`postgres`) is rejected with `"critical_process"` even when sharing a dev port (`3000`) with a regular process (`node`).

- **Target Validation & Scan Fail-Closed**:
  - `scanner::tests::kill_is_refused_when_the_port_list_is_unavailable`: Refuses kill when the port scan yields an empty list to avoid bypassing the critical process guard.
  - `scanner::tests::port_snapshot_lookup_does_not_scan_again`: Validates that `port_is_listening_with` evaluates against a supplied snapshot rather than triggering redundant `netstat`/`lsof` scans.

- **Windows Graceful Termination & Pinned Handle**:
  - `scanner::tests::windows_open_rejects_a_pid_that_is_not_running`: Rejects dead/unallocated PIDs with typed error.
  - `scanner::tests::windows_handle_pins_the_pid_against_reuse`: Opens a `PROCESS_TERMINATE` handle before validation to prevent TOCTOU recycling.
  - `scanner::tests::windows_policy_outranks_a_handle_that_cannot_be_opened`: Confirms that policy rejection takes precedence over handle access errors.
  - `scanner::tests::windows_stop_ends_the_process_without_paying_the_grace_period`: Windowless processes escalate immediately without delay.
  - `scanner::tests::windows_graceful_close_precedes_the_force`: Verifies graceful WM_CLOSE before forceful termination.

- **Trusted Restart Validation & Boundary**:
  - `scanner::tests::restart_trusted_refuses_an_unknown_port_and_pid`: Rejects restart for untracked `(port, pid)` endpoints without a launch record.
  - `scanner::tests::restart_unknown_endpoint_fails_before_spawning`: Asserts fail-closed refusal before attempting to spawn any child process.
  - `scanner::tests::build_launch_record_captures_a_vetted_dev_server`: Confirms vetting and jailing of dev launchers.
  - `scanner::tests::direct_spawn_preserves_argument_boundaries`: Validates that restart command arguments are preserved without shell evaluation.

### Frontend UI & IPC Boundary Tests

- **Kill Confirmation & Blast Radius**:
  - `src/features/ports/PortsPage.test.tsx` (`discloses sibling ports hidden by the filter in the Kill All confirmation`): Asserts that Kill All detects and lists filter-hidden sibling ports and total blast radius before confirming.
  - `src/features/ports/PortsPage.test.tsx` (`names protected Postgres, cancels safely, and deduplicates confirmed PIDs`): Confirms protected services cannot be killed from UI selection and cancels leave processes untouched.
  - `src/App.integration.test.tsx` (`kill calls invoke and shows STOPPED + toast`): Enforces that IPC `kill_process` is only called with `{ pid }` after confirmation.

- **Restart Affordance & Parameters**:
  - `src/App.integration.test.tsx` (`restart calls invoke with port and pid only`): Asserts `invoke('restart_process', { port: 3000, pid: 1111 })` and verifies no attacker-controllable `cmd` or `cwd` arguments are accepted or transmitted.
  - `src/features/ports/PortsPage.test.tsx` (`keeps every killed port as a STOPPED row regardless of restartability`): Verifies stopped rows remain visible with restart buttons displayed only when `start_cmd` and `project_path` exist.

---

## 3. End-to-End Suite (`e2e/critical.spec.ts`)

- **Scenarios Tested**:
  1. Desktop shell preserves ports, inspector, navigation, logs, and settings (`e2e/critical.spec.ts:21`).
  2. Compact shell scrolls and keeps inspector close operable (`e2e/critical.spec.ts:35`).
- **Harness Details**:
  - Web Server: `vite preview --port 1420 --strictPort`
  - Mock Layer: `e2e/fixtures/tauri.ts` intercepts `__TAURI_INTERNALS__` to deterministically emulate `get_ports`, `get_port_events`, `get_port_traffic`, `kill_process`, and `restart_process`.
- **Execution**: 2/2 tests passed in 3.4 seconds across Chromium workers.
