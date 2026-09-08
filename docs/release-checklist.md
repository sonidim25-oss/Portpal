# Release checklist — version sync

All shipped version identifiers must match before tagging a release.
Source of truth for the next version: `package.json` / `tauri.conf.json` (currently `0.2.0`).

## Files to bump together

| File | Key |
| --- | --- |
| `package.json` | `"version"` |
| `package-lock.json` | root `"version"` + `packages[""].version` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | `[[package]] name = "portpal"` → `version` (regenerated, never hand-edited alone) |

## Bump commands

```sh
# 1. Frontend truth (updates package.json AND package-lock.json together):
npm version 0.2.0 --no-git-tag-version

# 2. Mirror into Tauri config + Rust crate (edit the two version lines):
#    src-tauri/tauri.conf.json -> "version": "0.2.0"
#    src-tauri/Cargo.toml      -> version = "0.2.0"

# 3. Regenerate the Rust lockfile so it stays valid (preferred over manual edit):
cargo check --manifest-path src-tauri/Cargo.toml

# 4. Verify all five agree:
node -e "for (const [f,v] of [['package.json',require('./package.json').version],['package-lock.json',require('./package-lock.json').version],['src-tauri/tauri.conf.json',require('./src-tauri/tauri.conf.json').version]]) console.log(f,v)" && grep '^version' src-tauri/Cargo.toml && grep -A1 'name = "portpal"' src-tauri/Cargo.lock
```

Alternative for step 2 (if `cargo-edit` is installed): `cargo set-version 0.2.0 --manifest-path src-tauri/Cargo.toml`.

## CI guard

`.github/workflows/audit.yml` contains a `version-consistency` job that compares
`package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` and fails
on mismatch. Keep it read-only: no secrets, no auto-merge, no dependency bumps.
