// The same check as the app's own build.rs, asked first: this package is
// built only while local-embeddings is on, and has nothing to compile before
// its build script runs.
#[path = "../cpu_check.rs"]
mod cpu_check;

#[cfg(target_arch = "x86_64")]
fn host_has_avx2_bmi2() -> Option<bool> {
    Some(is_x86_feature_detected!("avx2") && is_x86_feature_detected!("bmi2"))
}

#[cfg(not(target_arch = "x86_64"))]
fn host_has_avx2_bmi2() -> Option<bool> {
    None
}

fn main() {
    println!("cargo:rerun-if-env-changed={}", cpu_check::OVERRIDE);
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let facts = cpu_check::Facts {
        embeddings_on: true,
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
