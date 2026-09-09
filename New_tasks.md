# PortPal — New Task List

Findings from driving the running app (`npm run tauri dev`, Windows 11, branch
`fix/windows-kill-graceful-handle` = current `main` + the kill-path work) on
2026-09-09, plus one repo-tooling issue noticed alongside.

None of these were introduced by the kill-path change under review; two are
pre-existing, one is stale tooling.

Status legend: `[ ]` open · `[x]` done · `[~]` resolved outside this work

---

## Summary

| Priority | Total | Done | Open |
|---|---|---|---|
| LOW | 2 | 2 | 0 |
| MEDIUM | 1 | 1 | 0 |
| **Total** | **3** | **3** | **0** |

---

# MEDIUM

## [x] Task: `add-tauri-command` skill tells you to register commands in two files

- **Location**: `.claude/skills/add-tauri-command/SKILL.md`, contradicted by `CLAUDE.md`
  ("There is one entrypoint: `src-tauri/src/lib.rs`")
- **Description**: The skill's own description says it covers "registration in **BOTH**
  `main.rs` and `lib.rs`". That is the pre-single-entrypoint layout. `main.rs` is now a
  10-line wrapper that calls `portpal_lib::run()` and nothing else, and `CLAUDE.md`
  explicitly names this guidance as out of date: *"If you find guidance elsewhere about
  'adding a command to both files', it is out of date."* A skill is loaded ahead of the
  file it edits, so it wins on first read — someone following it will look for a
  `Builder` in `main.rs` that no longer exists, and may reintroduce one.
- **Impact**: Higher than a stale comment. The two-entrypoint layout is exactly the bug
  the single-entrypoint change removed (a command registered in one `Builder` and missed
  in the shipped binary), and this skill still instructs people to recreate it.
- **Suggested Fix**: Update the skill body and its `description:` frontmatter to the
  single-entrypoint flow — command in `lib.rs`, permission in
  `src-tauri/capabilities/default.json` (see `docs/ipc-capabilities.md` — the list is
  exact, no aggregate `:default` sets), `invoke()` in the frontend. Check the rest of the
  skill against current `CLAUDE.md` while there; if more of it has drifted, regenerating
  it may beat patching.
- **Fixed by**: `23a1ea2` "docs(skill): update Tauri command workflow" (branch
  `fix/add-tauri-command-skill`). The rewritten skill states that `main.rs` is only a
  wrapper around `portpal_lib::run()` and that command wrappers, modules, builders and
  registrations never go there, covers the capability step, and ships an `rg` check that
  asserts `main.rs` stays free of `tauri::Builder` / `generate_handler!` /
  `#[tauri::command]`. The `description:` frontmatter no longer says "BOTH".

---

# LOW

## [x] Task: Kill confirmation renders a double period for a single process

- **Location**: `src/features/ports/KillConfirmation.tsx` (the `<p>` opening
  `{count} unique process…`)
- **Description**: The dialog reads **"1 unique process selected.. Termination can lose
  unsaved data and interrupt services."** — two periods. The sentence ends twice: the
  `{totalPorts > count && <>, affecting …</>}` fragment is followed by a literal `.`, and
  `{totalPorts <= count && '.'}` adds another when there are no hidden sibling ports. In
  the single-process case both render.
- **Repro**: Kill any port whose PID owns exactly one listener; read the first line of the
  confirmation dialog. Observed live, not inferred.
- **Suggested Fix**: One terminator. Move the period inside the conditional fragment so
  each branch supplies exactly one, and cover the single-process wording in
  `PortsPage.test.tsx` — the existing assertion matches `/1 unique process selected/`, so
  it passes either way.
- **Origin**: Arrived with the blast-radius disclosure (`b250134`), not with the kill-path
  change.

## [x] Task: Sidebar "Last scan" does not track the scan loop

- **Location**: sidebar status block ("Monitoring — N processes, N ports / Last scan: …");
  producer is `tray.rs`'s 2s poll and its `ports-updated` event
- **Description**: The label climbed 10s → 30s → 46s → 1m → 2m → 3m while the app was
  demonstrably scanning throughout: it picked up a new listener on :4321 within seconds,
  then reflected a kill (row → STOPPED, counts 26→25 ports, 20→19 processes) — both of
  which require fresh scans. At some point it reset to 24s on its own, then resumed
  climbing. So it is neither frozen nor tied to the 2s poll; it appears to track something
  that updates rarely, possibly "last change in the port set".
- **Impact**: This is the app's own liveness indicator. "Last scan: 3m ago" on a healthy
  2s poll reads as a stalled scanner — the exact condition `scan-degraded` /
  `scan-recovered` exist to report, so a user cannot tell a real degradation from this.
- **Suggested Fix**: Decide what the line means and make it say that. Either stamp it from
  every completed scan (then it should never exceed a few seconds while healthy), or keep
  the current semantics and relabel it ("Last change …"). Whichever way, assert it: no
  test currently pins this string.
- **Cause (confirmed)**: `lastScanAt` was stamped in `usePortPalData`'s `onPortsUpdated`
  handler, and `tray.rs` emits `ports-updated` only when the serialized port list differs
  from the previous tick. That gate is deliberate (no re-render for an identical list),
  but it makes the event a *change* signal, not a scan clock. The hypothesis above was
  right.
- **Fixed by**: PR #5 `fix/last-scan-heartbeat`. `tray.rs` now emits `scan-completed` on
  every successful tick, `ports-updated` keeps its change gate, and the hook stamps the
  clock from the heartbeat alone. A failed scan emits neither, so the value still climbs
  when scanning is genuinely broken. Measured in the running app: 10 heartbeats in 20s
  (the 2s poll) on an idle machine where the old wiring stamped the clock zero times.
  Three hook tests pin it; all three fail without the change.

---

## Verified working in the same session (no action needed)

Recorded so a later reviewer does not re-derive it: live rescan picking up and dropping a
listener, search filtering, category tabs, row selection and the port-intel inspector,
the kill confirmation's blast-radius disclosure, kill of a real windowless console process
(graceful → force, process gone and port released), the STOPPED row and its "Killed
node.exe on :4321" toast, and STOPPED rows obeying the active search.
