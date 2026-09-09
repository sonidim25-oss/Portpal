# Testing Gaps Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible evidence for Rust backend behavior, destructive process actions, and the existing Playwright E2E suite.

**Architecture:** Start with read-only baseline commands, then add only the smallest missing Rust tests for scan, kill, and restart contracts. Run the frontend and E2E suites against their supported test harnesses, recording environment limitations separately from product failures.

**Tech Stack:** Rust unit tests with Cargo, Tauri backend modules, Vitest, TypeScript, Playwright, Vite preview.

**Spec:** `tasks.md` entries for scan/kill/restart behavior and the supplied testing-gap report.

## Global Constraints

- Preserve the PID-only `kill_process(pid)` IPC contract and trusted `(port, pid)` restart contract.
- Never invoke a real destructive kill during automated tests; use pure policy tests and mocked or isolated child-process tests.
- Do not treat a hung command as passing or failing; report it as inconclusive with the command and timeout.
- Run Rust tests from `src-tauri` with `cargo test`.
- Run frontend tests with `npm run test:run`; run TypeScript verification with `npx tsc --noEmit`.
- Run Playwright only through the repository configuration and report missing browsers, Tauri runtime, or preview startup as environment blockers.

### Task 1: Establish the verification baseline

**Files:**
- Read: `CLAUDE.md`, `package.json`, `playwright.config.ts`, `src-tauri/src/scanner.rs`, `src-tauri/src/lib.rs`
- Test: repository test commands

**Interfaces:**
- Consumes: current repository and existing tests.
- Produces: a baseline result table with command, exit code, test count, and blocker text.

- [x] **Step 1: Check repository state and test configuration**

```powershell
git status --short --branch
Get-Content package.json
Get-Content playwright.config.ts
```

Record pre-existing modifications and the configured Playwright web server.

- [x] **Step 2: Run the complete Rust suite**

```powershell
cd src-tauri
cargo test
```

Expected: exit code 0 and all Rust tests reported as passed. Any warning is recorded separately.

- [x] **Step 3: Run the complete frontend suite and typecheck**

```powershell
cd ..
npm run test:run
npx tsc --noEmit
```

Expected: exit code 0 for both commands. Capture the exact Vitest file and test totals.

### Task 2: Close Rust destructive-action coverage

**Files:**
- Read/Modify: `src-tauri/src/scanner.rs`
- Test: `src-tauri/src/scanner.rs` unit-test module

**Interfaces:**
- Consumes: `validate_kill`, `kill_pid`, `restart_trusted`, `try_scan_ports`, and trusted launch records.
- Produces: Rust tests proving kill/restart fail-closed behavior without terminating an unrelated process.

- [x] **Step 1: Inventory existing kill and restart tests**

```powershell
cd src-tauri
rg -n -C 5 "kill_pid|validate_kill|restart_trusted|process_changed|scan_failed|trusted launch" src/scanner.rs
```

Mark coverage for reserved PIDs, critical names/ports, unknown listeners, scan failure, PID identity changes, invalid launch records, and successful direct argument handling.

- [x] **Step 2: Add the missing pure kill-policy tests before implementation changes**

Add tests in the existing `#[cfg(test)] mod tests` for these exact cases:

```rust
#[test]
fn kill_policy_rejects_a_critical_listener_even_when_another_pid_shares_the_port() {
    let ports = vec![listener(111, 3000, "node"), listener(222, 3000, "postgres")];
    let error = validate_kill(222, &ports, &[]).unwrap_err();
    assert_eq!(error.code, "critical_process");
}

#[test]
fn restart_unknown_endpoint_fails_before_spawning() {
    let error = restart_trusted(65534, 4_294_967_290).unwrap_err();
    assert!(error.contains("no trusted launch record"));
}
```

Use the existing `listener` helper and do not call a real OS kill.

- [x] **Step 3: Run the new tests before changing product code**

```powershell
cargo test scanner::tests::kill_policy_rejects_a_critical_listener_even_when_another_pid_shares_the_port scanner::tests::restart_unknown_endpoint_fails_before_spawning
```

Expected: the tests pass against current behavior. If a requested invariant fails, stop and document the failure before changing implementation.

- [x] **Step 4: Add coverage for the snapshot boundary**

Verify that `port_is_listening_with` consumes a supplied `&[PortInfo]` and that `restart_trusted` calls `try_scan_ports` once before `kill_pid_with`. Keep the test pure by asserting the lookup result from a supplied vector; use code review of the call graph for the exact spawn count.

- [x] **Step 5: Run the full Rust suite again**

```powershell
cargo test
```

Expected: exit code 0 with the new total reported. This is the required backend evidence for the review.

### Task 3: Verify the destructive-action UI-to-Rust boundary

**Files:**
- Read: `src/app/usePortPalData.ts`, `src/features/ports/PortsPage.tsx`, `src/lib/tauri.ts`, `src-tauri/src/lib.rs`
- Test: `src/App.integration.test.tsx`, `src/features/ports/PortsPage.test.tsx`, `src/app/usePortPalData.test.tsx`

**Interfaces:**
- Consumes: UI confirmation flow and Tauri gateway mocks.
- Produces: evidence that confirmation, payload shape, busy state, error mapping, and restart arguments remain aligned.

- [x] **Step 1: Verify kill payload and confirmation assertions**

```powershell
npx vitest run src/App.integration.test.tsx src/features/ports/PortsPage.test.tsx src/app/usePortPalData.test.tsx
```

Confirm the tests assert that kill is not invoked before confirmation, protected processes are refused, duplicate/busy entries are handled, and the IPC payload is `{ pid }`.

- [x] **Step 2: Verify restart payload assertions**

Add or retain an integration assertion for:

```typescript
expect(invoke).toHaveBeenCalledWith('restart_process', { port: 3000, pid: 1111 });
```

Also assert that a missing `start_cmd` or `project_path` does not invoke restart.

- [x] **Step 3: Re-run frontend tests and typecheck**

```powershell
npm run test:run
npx tsc --noEmit
```

Expected: zero failures and zero TypeScript errors.

### Task 4: Run and diagnose the Playwright E2E suite

**Files:**
- Read: `playwright.config.ts`, `e2e/`, `e2e/fixtures/tauri.ts`
- Modify only if required: E2E fixture or test files

**Interfaces:**
- Consumes: Vite preview and the repository Tauri IPC fixture.
- Produces: complete E2E pass evidence or a precise environment blocker.

- [x] **Step 1: Inspect E2E entry points and fixture coverage**

```powershell
rg -n "test\(|expect\(|__TAURI_INTERNALS__|get_ports|kill_process|restart_process" e2e playwright.config.ts
```

Map each test to the UI route and IPC fixture responses it exercises.

- [x] **Step 2: Run the E2E suite**

```powershell
npm run test:e2e
```

Expected: Playwright starts the configured preview server and exits 0. Record browser count, test count, and duration.

- [x] **Step 3: If Playwright fails, classify the failure**

Use the first actionable error and rerun only the failing test:

```powershell
npx playwright test e2e/critical.spec.ts --project=chromium
```

Classify it as product failure, fixture mismatch, preview startup failure, missing browser installation, or host limitation. Do not change production code for a host-only failure.

- [x] **Step 4: Re-run after a fixture or test fix**

```powershell
npm run test:e2e
```

Expected: full suite passes, or the final report names the persistent blocker and includes the exact error.

### Task 5: Produce the review evidence report

**Files:**
- Create: `docs/testing-verification-2026-09-09.md`

**Interfaces:**
- Consumes: outputs from Tasks 1–4.
- Produces: a self-contained report reviewers can audit without relying on chat history.

- [x] **Step 1: Record every verification command and result**

Use this table structure:

| Area | Command | Result | Evidence | Limitation |
|---|---|---|---|---|
| Rust backend | `cd src-tauri && cargo test` | PASS/FAIL/BLOCKED | totals and failing test | host/tool limitation |
| Frontend | `npm run test:run` | PASS/FAIL | Vitest totals | none or exact blocker |
| TypeScript | `npx tsc --noEmit` | PASS/FAIL | exit code | none or exact blocker |
| E2E | `npm run test:e2e` | PASS/FAIL/BLOCKED | Playwright totals | browser/server limitation |

- [x] **Step 2: Document destructive-action coverage explicitly**

List the Rust tests for reserved/critical/unknown targets, PID identity changes, scan failure, trusted restart validation, and direct argument boundaries. List the UI tests for confirmation and IPC payloads.

- [x] **Step 3: Review the report for unsupported claims**

Confirm that a passing unit suite is not described as real desktop manual verification, and that a blocked E2E run is not described as a product failure without supporting evidence.

- [x] **Step 4: Commit the verification artifacts**

```powershell
git add docs/superpowers/plans/2026-09-09-testing-gaps-verification.md docs/testing-verification-2026-09-09.md e2e/critical.spec.ts src-tauri/src/scanner.rs src-tauri/src/tray.rs src-tauri/src/logger.rs
git diff --cached --check
git commit -m "test: close backend and e2e verification gaps"
```

Run `git status --short --branch` after committing and keep unrelated changes out of the commit.
