// ==============================================================
// Phase 6 — OS Keychain bridge
//
// macOS: uses security-framework GenericPassword directly.
//   Entries have NO application ACL, so they survive DMG
//   rebuilds without prompting or losing keys.
//
// Other platforms: fall back to the `keyring` crate.
//
// JS calls:
//   invoke("keychain_store",    { provider, secret })
//   invoke("keychain_retrieve", { provider }) -> Option<String>
//   invoke("keychain_delete",   { provider })
// ==============================================================

const SERVICE: &str = "com.hashcortx.app";
const BUNDLE_ACCOUNT: &str = "__api_bundle__";

// ── macOS implementation ──────────────────────────────────────
#[cfg(target_os = "macos")]
mod platform {
    use super::SERVICE;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    pub fn store(provider: &str, secret: &str) -> Result<(), String> {
        set_generic_password(SERVICE, provider, secret.as_bytes())
            .map_err(|e| e.to_string())
    }

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

    pub fn store(provider: &str, secret: &str) -> Result<(), String> {
        entry(provider)?.set_password(secret).map_err(|e| e.to_string())
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
#[tauri::command]
pub fn keychain_store(provider: String, secret: String) -> Result<(), String> {
    if secret.trim().is_empty() {
        return keychain_delete(provider);
    }
    platform::store(&provider, &secret)
}

#[tauri::command]
pub fn keychain_retrieve(provider: String) -> Result<Option<String>, String> {
    platform::retrieve(&provider)
}

#[tauri::command]
pub fn keychain_delete(provider: String) -> Result<(), String> {
    platform::delete(&provider)
}

// ── Bundle commands — all keys in one keychain entry ─────────
// One Keychain entry = one macOS password prompt per new build.

#[tauri::command]
pub fn keychain_store_bundle(bundle: String) -> Result<(), String> {
    platform::store(BUNDLE_ACCOUNT, &bundle)
}

#[tauri::command]
pub fn keychain_retrieve_bundle() -> Result<Option<String>, String> {
    platform::retrieve(BUNDLE_ACCOUNT)
}
