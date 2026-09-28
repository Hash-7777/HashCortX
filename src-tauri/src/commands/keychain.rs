// ==============================================================
// The one-time migration out of the old Keychain bundle
//
// API keys do NOT live in the OS Keychain — docs/SECURITY.md explains the
// trade. A Keychain item's access control list is bound to the binary's code
// signature, and while the build is unsigned every new DMG carries a different
// one, so macOS prompted for a password per key on every update. Keys live in
// the app's own data directory instead, keyed by the bundle identifier, which
// survives a rebuild.
//
// What remains here is the way out of the old arrangement. On first run the
// renderer reads the old bundle, merges it into the local store, and deletes
// the Keychain entry so it can never prompt again.
//
// WHY ONLY THESE TWO
// ------------------
// Every registered command is an entry point the renderer can reach, so one
// nothing calls is surface with no feature paying for it, and a command that
// wrote a secret into the Keychain would undo what this app deliberately
// stopped doing. Only the way out is registered, and
// scripts/checks/native-surface.mjs fails on a command registered without a
// caller.
//
// macOS uses security-framework directly; entries have no application ACL, so
// an old bundle is still readable after a rebuild. Other platforms use the
// `keyring` crate.
//
// JS calls:
//   invoke("keychain_retrieve_bundle") -> Option<String>
//   invoke("keychain_delete", { provider })
// ==============================================================

const SERVICE: &str = "com.hashcortx.app";
const BUNDLE_ACCOUNT: &str = "__api_bundle__";

// ── macOS implementation ──────────────────────────────────────
#[cfg(target_os = "macos")]
mod platform {
    use super::SERVICE;
    use security_framework::passwords::{delete_generic_password, get_generic_password};

    pub fn retrieve(provider: &str) -> Result<Option<String>, String> {
        match get_generic_password(SERVICE, provider) {
            Ok(bytes) => {
                let s = String::from_utf8(bytes).map_err(|e| e.to_string())?;
                Ok(if s.is_empty() { None } else { Some(s) })
            }
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(provider: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, provider) {
            Ok(_) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()), // already gone
            Err(e) => Err(e.to_string()),
        }
    }
}

// ── Other platforms: use `keyring` crate ─────────────────────
#[cfg(not(target_os = "macos"))]
mod platform {
    use super::SERVICE;
    use keyring::Entry;

    fn entry(provider: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, provider).map_err(|e| e.to_string())
    }

    pub fn retrieve(provider: &str) -> Result<Option<String>, String> {
        match entry(provider)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(provider: &str) -> Result<(), String> {
        match entry(provider)?.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────

/// Read the old all-keys bundle, if a previous build left one behind.
#[tauri::command]
pub fn keychain_retrieve_bundle() -> Result<Option<String>, String> {
    platform::retrieve(BUNDLE_ACCOUNT)
}

/// Remove a Keychain entry. The renderer calls this with the bundle account
/// once the keys have been copied out, so the old entry stops existing.
#[tauri::command]
pub fn keychain_delete(provider: String) -> Result<(), String> {
    platform::delete(&provider)
}
