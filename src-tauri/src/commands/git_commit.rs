// ==============================================================
// A commit the person agreed to, made with their own git setup
//
// An agent's commands run in the system sandbox, which keeps them away from
// every key, so a commit made there cannot be signed: a repository that signs
// its commits got none. This is the one narrow way round it. The page names
// only the files, the title and the body; the two git lines are built here,
// from a fixed shape, in the open project and nowhere else:
//
//   git -c core.fsmonitor=false add -- <files>
//   git -c core.fsmonitor=false commit -m <title> [-m <body>] -- <files>
//
// Nothing can be added to them: no flag that skips the repository's hooks or
// its signing, amends a commit, or names another folder. They run as a
// command the person typed would, with their own git setup, so a commit is
// signed exactly as their other commits are; the settings named like a
// secret are still left out, the key agent's socket kept. git's file-watcher
// setting is switched off for them, since a repository can make it start a
// program. The repository's own hooks do run, outside the sandbox: the
// question the person answered before this says so (platform/tauri/
// hashcoder.js gitCommit, asked every time).
//
// JS call: invoke("git_commit_signed", { paths, title, body, cancelKey })
// -> { stage: "add" | "commit", output } with the output of the step that
// ran last. Called only by HC.code.gitCommit, after the question.
// ==============================================================

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::security::denylist;

/// The most files one commit names (as js/code/git.js COMMIT_MOST).
pub const MOST_FILES: usize = 40;
/// The longest title and body taken.
const TITLE_MOST: usize = 200;
const BODY_MOST: usize = 20_000;
/// How long either line may run.
pub const TIMEOUT_MS: u64 = 120_000;

/// What git is told before every line: no file-watcher program.
const QUIET: [&str; 2] = ["-c", "core.fsmonitor=false"];

/// A file named for the commit, as a path inside the project, or why not.
fn project_path(root: &Path, given: &str) -> Result<String, String> {
    let p = given.trim();
    if p.is_empty() || p.starts_with('-') || p.chars().any(|c| c.is_control()) {
        return Err(format!(
            "\"{}\" is not a plain file name",
            given.chars().take(80).collect::<String>()
        ));
    }
    let path = Path::new(p);
    let rel: PathBuf = if path.is_absolute() {
        path.strip_prefix(root)
            .map_err(|_| format!("{p} is not inside the open project"))?
            .to_path_buf()
    } else {
        path.to_path_buf()
    };
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!(
            "{p} must be a file inside the open project, written without \"..\""
        ));
    }
    if denylist::is_path_denied(&root.join(&rel).to_string_lossy()) {
        return Err(format!("{p} is a protected location"));
    }
    let shown = rel.to_string_lossy().replace('\\', "/");
    if shown.starts_with('-') {
        return Err(format!("{p} is not a plain file name"));
    }
    Ok(shown)
}

/// The two lines, built from the files, the title and the body, or why they cannot be.
pub fn commit_lines(
    root: &Path,
    paths: &[String],
    title: &str,
    body: Option<&str>,
) -> Result<(Vec<String>, Vec<String>), String> {
    if paths.is_empty() {
        return Err("no file was named".to_string());
    }
    if paths.len() > MOST_FILES {
        return Err(format!("more than {MOST_FILES} files were named"));
    }
    let mut files: Vec<String> = Vec::new();
    for p in paths {
        let f = project_path(root, p)?;
        if !files.contains(&f) {
            files.push(f);
        }
    }
    let title = title.trim();
    if title.is_empty()
        || title.chars().count() > TITLE_MOST
        || title.chars().any(|c| c.is_control())
    {
        return Err(format!(
            "the title must be one line of 1 to {TITLE_MOST} characters"
        ));
    }
    let body = body.map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = body {
        if b.chars().count() > BODY_MOST || b.contains('\0') {
            return Err(format!(
                "the body must be plain text of at most {BODY_MOST} characters"
            ));
        }
    }
    let quiet = || QUIET.iter().map(|s| s.to_string());
    let mut add: Vec<String> = quiet().collect();
    add.extend(["add", "--"].map(String::from));
    add.extend(files.iter().cloned());
    let mut commit: Vec<String> = quiet().collect();
    commit.extend(["commit", "-m", title].map(String::from));
    if let Some(b) = body {
        commit.extend(["-m".to_string(), b.to_string()]);
    }
    commit.push("--".to_string());
    commit.extend(files);
    Ok((add, commit))
}

#[derive(Serialize)]
pub struct CommitRun {
    /// The step that ran last: "add", or "commit" once the files were added.
    stage: &'static str,
    output: super::shell::ShellOutput,
}

#[tauri::command]
pub async fn git_commit_signed(
    paths: Vec<String>,
    title: String,
    body: Option<String>,
    cancel_key: Option<String>,
) -> Result<CommitRun, String> {
    super::off_main(move || {
        let root = crate::security::root_jail::root()
            .ok_or("No project is open, so nothing was committed.")?;
        let (add, commit) = commit_lines(&root, &paths, &title, body.as_deref())
            .map_err(|why| format!("The commit was not made: {why}."))?;
        let added = super::shell::run_signed(add, cancel_key.clone())?;
        if added.failed() {
            return Ok(CommitRun {
                stage: "add",
                output: added,
            });
        }
        let made = super::shell::run_signed(commit, cancel_key)?;
        Ok(CommitRun {
            stage: "commit",
            output: made,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) {
            r"C:\work\harbour-shop"
        } else {
            "/work/harbour-shop"
        })
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn builds_the_two_fixed_lines() {
        let (add, commit) = commit_lines(
            &root(),
            &s(&["src/cart.js", "src/new.js", "src/cart.js"]),
            " fix: keep the total ",
            Some("Totals were rounded."),
        )
        .unwrap();
        assert_eq!(
            add,
            s(&[
                "-c",
                "core.fsmonitor=false",
                "add",
                "--",
                "src/cart.js",
                "src/new.js"
            ])
        );
        assert_eq!(
            commit,
            s(&[
                "-c",
                "core.fsmonitor=false",
                "commit",
                "-m",
                "fix: keep the total",
                "-m",
                "Totals were rounded.",
                "--",
                "src/cart.js",
                "src/new.js"
            ])
        );
        let (_, plain) = commit_lines(&root(), &s(&["a.js"]), "fix: a", Some("  ")).unwrap();
        assert_eq!(
            plain,
            s(&[
                "-c",
                "core.fsmonitor=false",
                "commit",
                "-m",
                "fix: a",
                "--",
                "a.js"
            ])
        );
    }

    #[test]
    fn a_path_inside_the_project_written_in_full_is_taken_from_the_project() {
        let full = root().join("src").join("cart.js");
        let (add, _) = commit_lines(
            &root(),
            &[full.to_string_lossy().into_owned()],
            "fix: a",
            None,
        )
        .unwrap();
        assert_eq!(add.last().map(String::as_str), Some("src/cart.js"));
    }

    #[test]
    fn refuses_what_is_not_a_plain_file_in_the_project() {
        let outside = if cfg!(windows) {
            r"C:\elsewhere\a.js"
        } else {
            "/elsewhere/a.js"
        };
        for bad in [
            "../a.js",
            "src/../../a.js",
            "-a.js",
            "--no-verify",
            "a\nb.js",
            "",
            outside,
        ] {
            assert!(
                commit_lines(&root(), &s(&[bad]), "fix: a", None).is_err(),
                "took {bad:?}"
            );
        }
        assert!(commit_lines(&root(), &[], "fix: a", None).is_err());
        let many: Vec<String> = (0..=MOST_FILES).map(|i| format!("f{i}.js")).collect();
        assert!(commit_lines(&root(), &many, "fix: a", None).is_err());
    }

    #[test]
    fn refuses_a_title_or_body_that_is_not_plain() {
        for bad in ["", "   ", "fix: a\nmore", &"x".repeat(TITLE_MOST + 1)] {
            assert!(
                commit_lines(&root(), &s(&["a.js"]), bad, None).is_err(),
                "took title {bad:?}"
            );
        }
        assert!(commit_lines(&root(), &s(&["a.js"]), "fix: a", Some("a\0b")).is_err());
        assert!(commit_lines(
            &root(),
            &s(&["a.js"]),
            "fix: a",
            Some(&"x".repeat(BODY_MOST + 1))
        )
        .is_err());
    }

    #[test]
    fn nothing_given_can_reach_the_lines_as_a_flag() {
        // A title or body that looks like a flag is only the value of its -m, never one of git's own.
        let (add, commit) = commit_lines(
            &root(),
            &s(&["a.js"]),
            "--no-verify",
            Some("--amend --no-gpg-sign"),
        )
        .unwrap();
        assert_eq!(add, s(&["-c", "core.fsmonitor=false", "add", "--", "a.js"]));
        assert_eq!(
            commit,
            s(&[
                "-c",
                "core.fsmonitor=false",
                "commit",
                "-m",
                "--no-verify",
                "-m",
                "--amend --no-gpg-sign",
                "--",
                "a.js"
            ])
        );
    }

    /// A real repository on the disk, opened as the project, and git's own record read back.
    #[test]
    fn commits_only_the_named_file_in_the_open_project() {
        let turn = crate::security::root_jail::test_turn();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("fs-check-scratch")
            .join(format!("git-commit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(&dir)
                .output()
                .unwrap()
        };
        if !git(&["init", "-q"]).status.success() {
            return; // no git here: nothing to try
        }
        for (k, v) in [
            ("user.name", "Test Shop"),
            ("user.email", "shop@example.invalid"),
            ("commit.gpgsign", "false"),
        ] {
            git(&["config", k, v]);
        }
        std::fs::write(dir.join("src").join("cart.js"), "const total = 1;\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "the person's own\n").unwrap();
        git(&["add", "notes.txt"]); // staged by the person, not part of the commit
        crate::security::root_jail::set_root(&dir.to_string_lossy()).unwrap();
        let root = crate::security::root_jail::root().unwrap();
        let (add, commit) =
            commit_lines(&root, &s(&["src/cart.js"]), "fix: keep the total", None).unwrap();
        let added = crate::commands::shell::run_signed(add, None).unwrap();
        assert!(!added.failed(), "add failed");
        let made = crate::commands::shell::run_signed(commit, None).unwrap();
        assert!(!made.failed(), "commit failed");
        let shown =
            String::from_utf8_lossy(&git(&["show", "--name-only", "--format=%s", "HEAD"]).stdout)
                .into_owned();
        assert!(shown.starts_with("fix: keep the total\n"), "{shown}");
        assert!(
            shown.contains("src/cart.js") && !shown.contains("notes.txt"),
            "{shown}"
        );
        let staged =
            String::from_utf8_lossy(&git(&["diff", "--cached", "--name-only"]).stdout).into_owned();
        assert_eq!(
            staged.trim(),
            "notes.txt",
            "the person's own staged file is left staged"
        );
        crate::security::root_jail::clear_root();
        let _ = std::fs::remove_dir_all(&dir);
        drop(turn);
    }

    /// A repository that signs its commits gets a signed one: the line runs with the person's own git setup.
    #[test]
    fn a_repository_that_signs_gets_a_signed_commit() {
        let turn = crate::security::root_jail::test_turn();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("fs-check-scratch")
            .join(format!("git-signed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.with_extension("key");
        let _ = std::fs::remove_file(&key);
        let _ = std::fs::remove_file(key.with_extension("key.pub"));
        let made_key = std::process::Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-C", "test", "-f"])
            .arg(&key)
            .output();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(&dir)
                .output()
                .unwrap()
        };
        if !matches!(made_key, Ok(ref o) if o.status.success())
            || !git(&["init", "-q"]).status.success()
        {
            return; // no ssh-keygen or git here: nothing to try
        }
        let key_path = key.to_string_lossy().into_owned();
        for (k, v) in [
            ("user.name", "Test Shop"),
            ("user.email", "shop@example.invalid"),
            ("gpg.format", "ssh"),
            ("user.signingkey", key_path.as_str()),
            ("commit.gpgsign", "true"),
        ] {
            git(&["config", k, v]);
        }
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        crate::security::root_jail::set_root(&dir.to_string_lossy()).unwrap();
        let root = crate::security::root_jail::root().unwrap();
        let (add, commit) = commit_lines(&root, &s(&["a.txt"]), "fix: a", None).unwrap();
        assert!(!crate::commands::shell::run_signed(add, None)
            .unwrap()
            .failed());
        let made = crate::commands::shell::run_signed(commit, None).unwrap();
        assert!(!made.failed(), "commit failed");
        let raw =
            String::from_utf8_lossy(&git(&["cat-file", "commit", "HEAD"]).stdout).into_owned();
        assert!(
            raw.contains("gpgsig -----BEGIN SSH SIGNATURE-----"),
            "the commit carries no signature: {raw}"
        );
        crate::security::root_jail::clear_root();
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(&key);
        let _ = std::fs::remove_file(key.with_extension("key.pub"));
        drop(turn);
    }

    #[test]
    fn a_protected_location_is_refused() {
        assert!(commit_lines(&root(), &s(&[".ssh/id_ed25519"]), "fix: a", None).is_err());
        assert!(commit_lines(&root(), &s(&[".aws/credentials"]), "fix: a", None).is_err());
    }
}
