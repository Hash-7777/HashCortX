// ==============================================================
// HashCortx — will a build with the embedding runtime start here?
//
// The embedding runtime is linked into the app statically, and its start-up
// code runs while the program is still loading, before any code of ours. On an
// x86-64 processor without AVX2 and BMI2 that code stops the program: no
// window, no message. Nothing the app does can report it, so the only place a
// person can be told is where the app is built.
//
// This file holds the decision and the words, with nothing that reads the
// machine, so a test can give it every case. build.rs reads the facts and
// calls it; src/lib.rs includes it under test.
// ==============================================================

/// What a build knows about itself and the computer making it.
pub struct Facts<'a> {
    /// The `local-embeddings` feature is on, so the runtime is linked in.
    pub embeddings_on: bool,
    /// The processor the app is built for, as Cargo names it.
    pub target_arch: &'a str,
    /// The processor of the computer making the build.
    pub host_arch: &'a str,
    /// Whether that processor has AVX2 and BMI2; `None` where it cannot say.
    pub host_has_avx2_bmi2: Option<bool>,
    /// The person said the app is for another computer.
    pub allowed_anyway: bool,
}

pub enum Verdict {
    Fine,
    Refuse(String),
}

/// A build is refused only when it is certain to make an app that closes on
/// the very computer making it: the runtime is in, the target is x86-64, the
/// computer is x86-64 and lacks the instructions. Where the computer cannot be
/// judged, such as an Apple Silicon Mac building for Intel, the build goes on.
pub fn verdict(f: &Facts) -> Verdict {
    let would_not_start = f.embeddings_on
        && f.target_arch == "x86_64"
        && f.host_arch == "x86_64"
        && f.host_has_avx2_bmi2 == Some(false);
    if would_not_start && !f.allowed_anyway {
        Verdict::Refuse(refusal())
    } else {
        Verdict::Fine
    }
}

pub const OVERRIDE: &str = "HASHCORTX_ALLOW_ANY_CPU";

pub fn refusal() -> String {
    format!(
        "\n\
         This build includes the local embedding runtime, which needs a processor\n\
         with AVX2 and BMI2 (Intel Haswell, 2013, AMD Excavator, 2015, and newer).\n\
         This computer's processor does not have both, so the app built here would\n\
         close the moment it was opened, with no window and no message.\n\
         \n\
         Build the version without it instead:\n\
         \n\
         \x20   npx tauri build -- --no-default-features\n\
         \n\
         Through npm that needs two separators:\n\
         \n\
         \x20   npm run tauri build -- -- --no-default-features\n\
         \n\
         Searching the knowledge base then works by keyword, and nothing else\n\
         changes. To build with the runtime anyway, for another computer, set\n\
         {OVERRIDE}=1 and build again.\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> Facts<'static> {
        Facts {
            embeddings_on: true,
            target_arch: "x86_64",
            host_arch: "x86_64",
            host_has_avx2_bmi2: Some(false),
            allowed_anyway: false,
        }
    }

    fn refused(f: &Facts) -> bool {
        matches!(verdict(f), Verdict::Refuse(_))
    }

    #[test]
    fn a_build_that_would_close_on_its_own_computer_is_refused() {
        assert!(refused(&facts()));
    }

    #[test]
    fn a_processor_with_the_instructions_is_let_through() {
        assert!(!refused(&Facts {
            host_has_avx2_bmi2: Some(true),
            ..facts()
        }));
    }

    #[test]
    fn a_build_without_the_runtime_is_let_through() {
        assert!(!refused(&Facts {
            embeddings_on: false,
            ..facts()
        }));
    }

    #[test]
    fn a_build_for_another_kind_of_processor_is_let_through() {
        assert!(!refused(&Facts {
            target_arch: "aarch64",
            ..facts()
        }));
    }

    #[test]
    fn a_computer_that_cannot_be_judged_is_let_through() {
        // An Apple Silicon Mac building for Intel, or any host that cannot ask.
        assert!(!refused(&Facts {
            host_arch: "aarch64",
            host_has_avx2_bmi2: None,
            ..facts()
        }));
        assert!(!refused(&Facts {
            host_has_avx2_bmi2: None,
            ..facts()
        }));
    }

    #[test]
    fn saying_the_app_is_for_another_computer_lets_it_through() {
        assert!(!refused(&Facts {
            allowed_anyway: true,
            ..facts()
        }));
    }

    #[test]
    fn the_message_says_what_to_run_and_how_to_go_on_anyway() {
        let text = refusal();
        assert!(text.contains("npx tauri build -- --no-default-features"));
        assert!(text.contains("npm run tauri build -- -- --no-default-features"));
        assert!(text.contains(&format!("{OVERRIDE}=1")));
        assert!(text.contains("AVX2 and BMI2"));
    }
}
