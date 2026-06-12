// ==============================================================
// HashCortx — desktop binary entry point
//
// This file is intentionally tiny. All real logic lives in
// lib.rs so it can be tested independently and reused by the
// mobile entry point (which is gated in lib.rs via #[cfg_attr]).
//
// DO NOT add business logic here. Add it to lib.rs instead.
// ==============================================================

// ── Windows console window suppression ────────────────────────
// On Windows, Rust programs open a black console window behind
// the main app window unless you set windows_subsystem = "windows".
// This attribute strips that console from RELEASE builds only —
// debug builds keep it so you can see println! output.
//
// ⚠ DO NOT REMOVE — users would see a flash of a console window
//   every time they launch the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hashcortx_lib::run()
}
