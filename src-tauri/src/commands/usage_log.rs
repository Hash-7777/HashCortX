// ==============================================================
// Token-usage log — HashMeter ecosystem
//
// Every model response appends ONE JSON line — token counts only,
// never any message content — to:
//   ~/.hashcortx/usage.jsonl
//
// HashMeterAi reads this file to report HashCortx token usage as
// MEASURED (not estimated), the same way it reads Claude Code / Kimi
// transcripts. The line carries a UTC timestamp, the model id, and
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
use std::fs::{create_dir_all, OpenOptions};
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

#[tauri::command]
pub fn usage_log_append(record: UsageRecord) -> Result<(), String> {
    let path = log_path();
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|e| e.to_string())?;
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
}
