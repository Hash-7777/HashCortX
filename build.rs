// ==============================================================
// HashCortx — Tauri build script
//
// Cargo runs this file BEFORE compiling the main crate, during
// `cargo build` / `npm run tauri build` / `npm run tauri dev`.
//
// tauri_build::build() does several things automatically:
//   1. Reads tauri.conf.json and validates it against the schema
//   2. Generates the capability schemas used by the IDE
//   3. Embeds the app icon and metadata into the binary
//   4. On Windows: embeds the application manifest (UAC, DPI, etc.)
//   5. Sets `cargo:rerun-if-changed` directives so Cargo only
//      re-runs this script when tauri config files change
//
// You should NEVER need to modify this file. If you do need a
// custom build step (e.g. code generation), add it below the
// tauri_build::build() call — never before it.
// ==============================================================

fn main() {
    tauri_build::build()
}
