// ==============================================================
// Saving a file the user asked for
//
// Every export in this app used to be `a.download = name; a.click()`, and that
// has never written a file. A download is a capability the embedder opts into,
// and this app never registered a download handler, so wry answers the
// navigation with `WKNavigationActionPolicy::Cancel` and the click does
// nothing at all. Chat exports, Coder exports, Forge's GLB, ERP's CSV, Virtual
// OS's zip and every document `execute_python` produced all ended there. See
// the header of src/platform/tauri/save.js for the full trace.
//
// So a save is a real write now. The destination always comes from the native
// save dialog: the user names the file and chooses where it goes, which is
// what makes writing outside the project acceptable here when `fs_write_file`
// would refuse it.
//
// WHY THIS IS NOT `fs_write_file`
// -------------------------------
// That command takes a String. Half of what this app produces is binary — GLB,
// PDF, xlsx, docx, png, zip — and routing those through a String corrupts
// them. It is also an agent tool, gated by the Permission Guard, and reached
// on a path a model can drive. Nothing here is reachable from a model: every
// call begins with a user clicking Export and picking a destination.
//
// The denylist still applies. A native dialog is consent to save a file, not
// consent to overwrite ~/.ssh/id_ed25519, and a dialog can be steered by
// whatever the app puts in `defaultPath`.
//
// JS calls:
//   invoke("export_write_file", { path, base64 })
// ==============================================================

use crate::commands::fs::guard_path;

/// Refuse anything larger than this. An export is a document, not a disk
/// image; a request past this size means something built a payload in a loop,
/// and the base64 for it has already cost four bytes of memory for every three
/// written.
const MAX_EXPORT_BYTES: usize = 256 * 1024 * 1024;

/// Decode standard base64 (RFC 4548) with no line breaks.
///
/// Written here rather than pulled in as a dependency: it is thirty lines, the
/// input is one shape produced by one caller, and this crate's other
/// self-contained addition (`net.rs`) took the same route.
///
/// Strict on purpose. Silently skipping bytes it does not understand is how a
/// decoder turns a transport bug into a corrupt file that opens far enough to
/// look fine, so anything outside the alphabet is an error.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn sextet(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some((byte - b'A') as u32),
            b'a'..=b'z' => Some((byte - b'a') as u32 + 26),
            b'0'..=b'9' => Some((byte - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let body: &[u8] = input.trim().as_bytes();
    // Padding is counted, not skipped: it tells us how many bytes of the final
    // group are real, and a wrong count silently shortens or lengthens the file.
    let (data, padding) = match body {
        [rest @ .., b'=', b'='] => (rest, 2),
        [rest @ .., b'='] => (rest, 1),
        rest => (rest, 0),
    };

    if data.len() % 4 == 1 {
        return Err("Encoded data is truncated.".into());
    }
    if padding > 0 && (data.len() + padding) % 4 != 0 {
        return Err("Encoded data is padded incorrectly.".into());
    }

    let capacity = data.len() / 4 * 3 + 3;
    if capacity > MAX_EXPORT_BYTES {
        return Err(format!(
            "That file is larger than the {} MB this app will write in one go.",
            MAX_EXPORT_BYTES / (1024 * 1024)
        ));
    }

    let mut out: Vec<u8> = Vec::with_capacity(capacity);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &byte in data {
        let value = sextet(byte)
            .ok_or_else(|| "Encoded data contains a character that is not base64.".to_string())?;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    // Whatever is left is the zero-fill of the final group. If it carries any
    // set bits the input did not come from an encoder, so say so rather than
    // writing a file that is one byte wrong.
    if bits > 0 && (acc & ((1 << bits) - 1)) != 0 {
        return Err("Encoded data has trailing bits that do not decode.".into());
    }
    Ok(out)
}

/// Write `base64` to `path`, and answer with how many bytes landed.
///
/// The byte count is returned rather than `()` so the caller can tell the user
/// something true about what happened. An export that reports success without
/// having written anything is the failure this whole file exists to end.
#[tauri::command]
pub fn export_write_file(path: String, base64: String) -> Result<u64, String> {
    guard_path(&path)?;
    // Guard the directory as well. Without this a denied folder could still be
    // written into, because `is_path_denied` matches the spelling it is given
    // and a new file's own path has not been seen before.
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() {
            guard_path(&parent_str)?;
        }
    }

    let bytes = decode_base64(&base64)?;
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(format!(
            "That file is larger than the {} MB this app will write in one go.",
            MAX_EXPORT_BYTES / (1024 * 1024)
        ));
    }

    // The parent is not created. The user picked this location in a native
    // dialog, so it exists; building a tree they did not ask for would be a
    // different action from the one they approved.
    std::fs::write(&path, &bytes).map_err(|e| format!("Could not save \"{path}\": {e}"))?;
    Ok(bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(ALPHABET[(n >> 18) as usize & 63] as char);
            out.push(ALPHABET[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(n >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[n as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }

    #[test]
    fn decodes_what_an_encoder_produced() {
        // Every remainder past a 3-byte group, because that is where padding
        // decides how many bytes of the last group are real.
        for len in 0..=64usize {
            let original: Vec<u8> = (0..len).map(|i| (i * 7 + 3) as u8).collect();
            let decoded = decode_base64(&encode(&original)).expect("valid base64 decodes");
            assert_eq!(decoded, original, "round trip failed at {len} bytes");
        }
    }

    #[test]
    fn decodes_every_byte_value() {
        // A binary export is the point. If any byte value fails to survive, a
        // GLB or a PDF is quietly corrupt.
        let original: Vec<u8> = (0..=255u8).collect();
        assert_eq!(decode_base64(&encode(&original)).unwrap(), original);
    }

    #[test]
    fn refuses_characters_outside_the_alphabet() {
        assert!(decode_base64("aGVsbG8h!").is_err());
        assert!(decode_base64("aGVs bG8h").is_err());
        // A data: URL prefix is a plausible caller mistake, and decoding it as
        // if it were the file would write the header into the file.
        assert!(decode_base64("data:text/plain;base64,aGk=").is_err());
    }

    #[test]
    fn refuses_truncated_and_misplaced_padding() {
        assert!(decode_base64("aGVsbG8hZ").is_err());
        assert!(decode_base64("aG=").is_err());
    }

    #[test]
    fn empty_input_decodes_to_nothing() {
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn refuses_to_write_into_a_protected_location() {
        // The whole reason the denylist still applies to a path the user chose
        // in a dialog: the dialog's starting point is set by the app, and an
        // overwrite here would destroy a credential rather than leak one.
        let home = dirs::home_dir().expect("a home directory");
        let secret = home.join(".ssh").join("id_ed25519");
        let err = export_write_file(secret.to_string_lossy().into_owned(), String::new())
            .expect_err("a protected path must be refused");
        assert!(err.contains("protected"), "unexpected refusal: {err}");
    }

    #[test]
    fn refuses_traversal() {
        // The target is somewhere this test could genuinely write, so the only
        // thing that can refuse it is the guard. Pointing this at /etc/hosts
        // instead would pass whether the guard ran or not — the write would
        // fail on permissions, and the test would be measuring the OS.
        let probe = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("export-check-scratch")
            .join("..")
            .join("traversal-probe.bin");
        let err = export_write_file(probe.to_string_lossy().into_owned(), String::new())
            .expect_err("traversal must be refused");
        assert!(err.contains(".."), "unexpected refusal: {err}");
    }

    #[test]
    fn writes_the_bytes_it_was_given() {
        // Scratch space lives under the crate, not env::temp_dir(): on macOS
        // that canonicalises under /private/var, which the denylist refuses,
        // and the test would fail for a reason that has nothing to do with it.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("export-check-scratch");
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("written.bin");
        let _ = std::fs::remove_file(&target);

        let payload: Vec<u8> = (0..=255u8).chain(0..=255u8).collect();
        let written = export_write_file(
            target.to_string_lossy().into_owned(),
            encode(&payload),
        )
        .expect("a chosen destination is written");

        assert_eq!(written, payload.len() as u64);
        assert_eq!(std::fs::read(&target).unwrap(), payload);
        let _ = std::fs::remove_file(&target);
    }
}
