// ==============================================================
// Pushing, pulling and fetching a branch the person agreed to
//
// An agent's commands run in the system sandbox, kept away from every
// sign-in, so a push from there cannot reach the code host. This is the one
// narrow way round it, and it keeps the wall for everything else. The page
// names a verb, a remote and a branch; the git line is built here from a
// fixed table and nothing else can be passed:
//
//   push   git -c core.fsmonitor=false push <remote> HEAD:refs/heads/<branch>
//   pull   git -c core.fsmonitor=false pull --ff-only <remote> <branch>
//   fetch  git -c core.fsmonitor=false fetch <remote>
//
// No force, no deleting a branch on the remote, no other repository: the
// remote must be one the open project's own git config already names, and
// the branch a plain branch name. It runs in the open project with the
// person's own git sign-in (their credential helper, or the key agent they
// already unlocked), with no terminal to ask in, and the settings named like
// a secret left out. The model never sees a credential; neither does the
// page. The question the person answered before this showed where the code
// goes, the branch and the commits (platform/tauri/hashcoder.js gitRemote,
// asked every time).
//
// JS call: invoke("git_remote_run", { verb, remote, branch, cancelKey })
// -> the command's output. Called only by HC.code.gitRemote, after the question.
// ==============================================================

use std::path::Path;

/// How long a push, pull or fetch may run.
pub const TIMEOUT_MS: u64 = 120_000;

/// The remotes a repository's own config names, in the order written.
pub fn remote_names(config: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in config.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("[remote \"") {
            if let Some(name) = rest.strip_suffix("\"]") {
                if plain_remote(name) && !out.iter().any(|n: &String| n == name) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out
}

fn plain_remote(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && !name.starts_with('-')
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// A branch name git takes as one, and nothing a line could read as more.
pub fn plain_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 120
        && !b.starts_with('-')
        && !b.starts_with('/')
        && !b.ends_with('/')
        && !b.ends_with('.')
        && !b.ends_with(".lock")
        && !b.contains("..")
        && !b.contains("//")
        && !b.contains("@{")
        && b != "@"
        && b.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.')
}

/// The git line for a verb, a remote the config names, and a branch, or why not.
pub fn remote_line(
    verb: &str,
    remote: &str,
    branch: Option<&str>,
    remotes: &[String],
) -> Result<Vec<String>, String> {
    if !remotes.iter().any(|r| r == remote) {
        return Err(format!(
            "\"{}\" is not a remote this repository names",
            remote.chars().take(60).collect::<String>()
        ));
    }
    let branch_ok = |b: Option<&str>| -> Result<String, String> {
        match b {
            Some(b) if plain_branch(b) => Ok(b.to_string()),
            _ => Err("the branch must be a plain branch name".to_string()),
        }
    };
    let mut line: Vec<String> = vec!["-c".into(), "core.fsmonitor=false".into()];
    match verb {
        "push" => {
            let b = branch_ok(branch)?;
            line.extend([
                "push".to_string(),
                remote.to_string(),
                format!("HEAD:refs/heads/{b}"),
            ]);
        }
        "pull" => {
            let b = branch_ok(branch)?;
            line.extend([
                "pull".to_string(),
                "--ff-only".to_string(),
                remote.to_string(),
                b,
            ]);
        }
        "fetch" => line.extend(["fetch".to_string(), remote.to_string()]),
        _ => {
            return Err(format!(
                "{} is not push, pull or fetch",
                verb.chars().take(20).collect::<String>()
            ))
        }
    }
    Ok(line)
}

/// The remotes of the repository at `root`, read from its own config.
fn remotes_of(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join(".git").join("config"))
        .map(|c| remote_names(&c))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn git_remote_run(
    verb: String,
    remote: String,
    branch: Option<String>,
    cancel_key: Option<String>,
) -> Result<super::shell::ShellOutput, String> {
    super::off_main(move || {
        let root =
            crate::security::root_jail::root().ok_or("No project is open, so nothing was sent.")?;
        let line = remote_line(&verb, &remote, branch.as_deref(), &remotes_of(&root))
            .map_err(|why| format!("Nothing was sent: {why}."))?;
        super::shell::run_signed_for(line, cancel_key, TIMEOUT_MS)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn reads_the_remotes_a_config_names() {
        let config = "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = x\n[remote \"backup\"]\n\turl = y\n[remote \"-bad\"]\n[branch \"main\"]\n\tremote = origin\n";
        assert_eq!(remote_names(config), s(&["origin", "backup"]));
    }

    #[test]
    fn builds_each_line_from_the_table() {
        let r = s(&["origin"]);
        assert_eq!(
            remote_line("push", "origin", Some("cart"), &r).unwrap(),
            s(&[
                "-c",
                "core.fsmonitor=false",
                "push",
                "origin",
                "HEAD:refs/heads/cart"
            ])
        );
        assert_eq!(
            remote_line("pull", "origin", Some("feature/cart"), &r).unwrap(),
            s(&[
                "-c",
                "core.fsmonitor=false",
                "pull",
                "--ff-only",
                "origin",
                "feature/cart"
            ])
        );
        assert_eq!(
            remote_line("fetch", "origin", None, &r).unwrap(),
            s(&["-c", "core.fsmonitor=false", "fetch", "origin"])
        );
    }

    #[test]
    fn refuses_another_remote_a_flag_or_a_branch_that_is_not_one() {
        let r = s(&["origin"]);
        assert!(remote_line("push", "elsewhere", Some("cart"), &r).is_err());
        assert!(remote_line("push", "--force", Some("cart"), &r).is_err());
        for bad in [
            "",
            "-f",
            "--force",
            "+cart",
            ":cart",
            "cart:main",
            "a..b",
            "a b",
            "cart@{1}",
            "@",
            "cart/",
            "/cart",
            "cart.lock",
            "x~1",
            "x^",
        ] {
            assert!(
                remote_line("push", "origin", Some(bad), &r).is_err(),
                "took {bad:?}"
            );
        }
        assert!(remote_line("push", "origin", None, &r).is_err());
        for verb in ["delete", "push --force", "clone", ""] {
            assert!(
                remote_line(verb, "origin", Some("cart"), &r).is_err(),
                "took {verb:?}"
            );
        }
    }

    #[test]
    fn no_line_can_force_or_delete() {
        let r = s(&["origin"]);
        for verb in ["push", "pull", "fetch"] {
            let line = remote_line(verb, "origin", Some("cart"), &r).unwrap();
            assert!(
                !line.iter().any(|a| a.starts_with("--force")
                    || a == "-f"
                    || a == "--delete"
                    || a == "-d"
                    || a.starts_with('+')
                    || a.starts_with(':')),
                "{line:?}"
            );
        }
    }

    /// A real push to a repository on the disk, through the same runner.
    #[test]
    fn pushes_the_branch_to_a_remote_the_repository_names() {
        let turn = crate::security::root_jail::test_turn();
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("fs-check-scratch")
            .join(format!("git-remote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (dir, bare) = (base.join("shop"), base.join("host.git"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&bare).unwrap();
        let git = |at: &Path, args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(at)
                .output()
        };
        if !matches!(git(&bare, &["init", "-q", "--bare"]), Ok(ref o) if o.status.success()) {
            return; // no git here: nothing to try
        }
        git(&dir, &["init", "-q"]).unwrap();
        for (k, v) in [
            ("user.name", "Test Shop"),
            ("user.email", "shop@example.invalid"),
            ("commit.gpgsign", "false"),
        ] {
            git(&dir, &["config", k, v]).unwrap();
        }
        git(&dir, &["remote", "add", "origin", &bare.to_string_lossy()]).unwrap();
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        git(&dir, &["add", "a.txt"]).unwrap();
        git(&dir, &["commit", "-q", "-m", "fix: a"]).unwrap();
        crate::security::root_jail::set_root(&dir.to_string_lossy()).unwrap();
        let root = crate::security::root_jail::root().unwrap();
        let line = remote_line("push", "origin", Some("cart"), &remotes_of(&root)).unwrap();
        let out = crate::commands::shell::run_signed_for(line, None, TIMEOUT_MS).unwrap();
        assert!(!out.failed(), "push failed");
        let there =
            String::from_utf8_lossy(&git(&bare, &["log", "--format=%s", "cart"]).unwrap().stdout)
                .into_owned();
        assert_eq!(there.trim(), "fix: a");
        crate::security::root_jail::clear_root();
        let _ = std::fs::remove_dir_all(&base);
        drop(turn);
    }
}
