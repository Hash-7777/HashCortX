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

// Whether a build with the embedding runtime starts on the computer making it
// is decided in cpu_check.rs; this file only reads the facts.
mod cpu_check;

/// Whether this computer's processor has AVX2 and BMI2. A build script runs on
/// the computer making the build, so this asks that computer. `None` on any
/// processor that is not x86-64, where the question does not apply.
#[cfg(target_arch = "x86_64")]
fn host_has_avx2_bmi2() -> Option<bool> {
    Some(is_x86_feature_detected!("avx2") && is_x86_feature_detected!("bmi2"))
}

#[cfg(not(target_arch = "x86_64"))]
fn host_has_avx2_bmi2() -> Option<bool> {
    None
}

fn main() {
    tauri_build::build();

    println!("cargo:rerun-if-env-changed={}", cpu_check::OVERRIDE);
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let facts = cpu_check::Facts {
        embeddings_on: std::env::var_os("CARGO_FEATURE_LOCAL_EMBEDDINGS").is_some(),
        target_arch: &target_arch,
        host_arch: std::env::consts::ARCH,
        host_has_avx2_bmi2: host_has_avx2_bmi2(),
        allowed_anyway: std::env::var_os(cpu_check::OVERRIDE).is_some_and(|v| v == "1"),
    };
    if let cpu_check::Verdict::Refuse(why) = cpu_check::verdict(&facts) {
        eprintln!("{why}");
        std::process::exit(1);
    }
}
