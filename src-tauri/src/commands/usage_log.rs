// ==============================================================
// Token-usage log — HashMeter ecosystem
//
// Every model response appends ONE JSON line — token counts only,
// never any message content — to:
//   ~/.hashcortx/usage.jsonl
//
// HashMeterAi reads this file to report HashCortx token usage as
// MEASURED (not estimated), the same way it reads other tools' own
// session logs. The line carries a UTC timestamp, the model id, and
// token/cost counts — nothing about the prompt or the answer.
//
// The field names ARE the on-disk contract shared with HashCerebrum
// and consumed by HashMeterAi — do not rename without updating both.
//
// JS calls:
//   invoke("usage_log_append", { record: { ts, model, input_tokens,
//           output_tokens, cache_read?, cache_write?, cost? } })
// ==============================================================

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

fn log_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".hashcortx").join("usage.jsonl")
}

#[derive(Serialize, Deserialize)]
pub struct UsageRecord {
    pub ts: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    #[serde(default)]
    pub cost: f64,
}

/// The longest model id and timestamp accepted. Real ones are far shorter. A
/// record past either is refused rather than cut: a shortened model id would
/// be counted as a different model. Each line is therefore bounded, and lines
/// come one per model response; the file is not rotated, because HashMeterAi
/// reads this one file.
const MAX_MODEL_CHARS: usize = 256;
const MAX_TS_CHARS: usize = 64;

fn check(record: &UsageRecord) -> Result<(), String> {
    if record.model.chars().count() > MAX_MODEL_CHARS {
        return Err("usage record refused: the model id is too long".into());
    }
    if record.ts.chars().count() > MAX_TS_CHARS {
        return Err("usage record refused: the timestamp is too long".into());
    }
    Ok(())
}

#[tauri::command]
pub fn usage_log_append(record: UsageRecord) -> Result<(), String> {
    check(&record)?;
    let path = log_path();
    if let Some(parent) = path.parent() {
        crate::security::private_dir::create(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())? + "\n";
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_serializes_to_one_compact_line() {
        let rec = UsageRecord {
            ts: "2026-06-12T01:22:09Z".into(),
            model: "llama-3.3-70b".into(),
            input_tokens: 4120,
            output_tokens: 880,
            cache_read: 0,
            cache_write: 0,
            cost: 0.0,
        };
        let line = serde_json::to_string(&rec).unwrap();
        assert!(line.contains("\"input_tokens\":4120"));
        assert!(line.contains("\"output_tokens\":880"));
        assert!(line.contains("\"model\":\"llama-3.3-70b\""));
        // The log line must never carry message content.
        assert!(!line.contains("content"));
    }

    #[test]
    fn optional_fields_default_when_absent() {
        let rec: UsageRecord =
            serde_json::from_str(r#"{"ts":"t","model":"m","input_tokens":10,"output_tokens":5}"#)
                .unwrap();
        assert_eq!(rec.input_tokens, 10);
        assert_eq!(rec.cache_read, 0);
        assert_eq!(rec.cost, 0.0);
    }

    fn record(ts: &str, model: &str) -> UsageRecord {
        UsageRecord {
            ts: ts.into(),
            model: model.into(),
            input_tokens: 1,
            output_tokens: 1,
            cache_read: 0,
            cache_write: 0,
            cost: 0.0,
        }
    }

    #[test]
    fn a_real_record_is_accepted() {
        let rec = record("2026-06-12T01:22:09.123Z", "cloud:openrouter:vendor/some-model-70b-instruct:free");
        assert!(check(&rec).is_ok());
    }

    #[test]
    fn a_model_id_up_to_the_limit_is_accepted_and_one_past_it_is_refused() {
        assert!(check(&record("t", &"m".repeat(MAX_MODEL_CHARS))).is_ok());
        assert!(check(&record("t", &"m".repeat(MAX_MODEL_CHARS + 1))).is_err());
    }

    #[test]
    fn an_overlong_timestamp_is_refused() {
        assert!(check(&record(&"1".repeat(MAX_TS_CHARS), "m")).is_ok());
        assert!(check(&record(&"1".repeat(MAX_TS_CHARS + 1), "m")).is_err());
    }
}
