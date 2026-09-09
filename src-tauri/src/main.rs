#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Canonical Tauri entry point lives in `lib.rs` (`portpal_lib::run`).
// This binary wrapper exists only so `cargo run` / the packaged binary has a
// `main`; all commands, setup, and window handling are defined once in the
// library to prevent lib/main drift where a fix lands in one and misses the
// shipped binary.
fn main() {
    portpal_lib::run()
}
