// ==============================================================
// Local embeddings — bge-small-en-v1.5, run natively
//
// Turns text into a 384-number vector so the knowledge base can find a
// passage that MEANS the same thing as your question rather than one that
// happens to share its words.
//
// WHY THIS IS IN RUST AND NOT THE WEB VIEW
// ----------------------------------------
// The previous implementation lived in app.js: it imported transformers.js
// from a CDN and let it fetch weights from huggingface.co. connect-src does
// not permit that host, so every embedding call threw, was swallowed by an
// empty catch, and no chunk ever received a vector. Semantic search has
// therefore never once run in a shipped build, while the code and the
// comments around it described a working hybrid retriever.
//
// Doing it here fixes that at the root and costs nothing at runtime:
//   • nothing is fetched, so no CSP rule can silently disable it
//   • no ONNX Runtime WebAssembly build to vendor (~10 MB) or keep in step
//   • native inference — measured at roughly 1 ms per passage on an M-series
//     Mac, about 35 ms for a batch of 32
//
// The weights are compiled INTO the binary with include_bytes! rather than
// shipped alongside it as a bundle resource. That trades ~34 MB of binary
// size for two things worth having: the model cannot be missing, moved, or
// swapped on disk by another process, and there is no resource-path code
// that behaves one way under `tauri dev` and another inside the .app.
//
// JS call:
//   invoke("embed_texts", { texts: [...], kind: "query" | "passage" })
//   → [[f32; 384], …]  L2-normalised, so cosine similarity is a dot product
// ==============================================================

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use std::sync::{Mutex, OnceLock};
use tokenizers::Tokenizer;

/// Weights and vocabulary, baked into the binary. See models/…/PROVENANCE.md.
const MODEL_ONNX: &[u8] = include_bytes!("../../models/bge-small-en-v1.5/model_quantized.onnx");
const TOKENIZER_JSON: &[u8] = include_bytes!("../../models/bge-small-en-v1.5/tokenizer.json");

/// Output width. Stored vectors are meaningless across a change to this.
pub const EMBED_DIM: usize = 384;

/// What the model was trained to accept; longer text is truncated by the tokenizer.
const MAX_TOKENS: usize = 512;

/// BGE is an asymmetric retriever: the QUERY side is embedded with this
/// instruction and passages are embedded bare. Embedding both the same way
/// measurably costs recall, so this is not decoration.
const QUERY_INSTRUCTION: &str = "Represent this sentence for searching relevant passages: ";

/// Caps, so a runaway caller cannot exhaust memory. A batch of this size takes
/// well under a second; anything larger is a caller bug, not a workload.
const MAX_BATCH: usize = 64;
const MAX_CHARS: usize = 8_000;

struct Embedder {
    session: Session,
    tokenizer: Tokenizer,
}

static EMBEDDER: OnceLock<Result<Mutex<Embedder>, String>> = OnceLock::new();

fn embedder() -> Result<&'static Mutex<Embedder>, String> {
    EMBEDDER
        .get_or_init(|| {
            let mut tokenizer =
                Tokenizer::from_bytes(TOKENIZER_JSON).map_err(|e| format!("tokenizer: {e}"))?;
            // Pad to the longest item in the batch and truncate at the model's
            // limit. Without this a batch of uneven lengths cannot be stacked
            // into one tensor.
            tokenizer
                .with_padding(Some(tokenizers::PaddingParams {
                    strategy: tokenizers::PaddingStrategy::BatchLongest,
                    ..Default::default()
                }))
                .with_truncation(Some(tokenizers::TruncationParams {
                    max_length: MAX_TOKENS,
                    ..Default::default()
                }))
                .map_err(|e| format!("tokenizer truncation: {e}"))?;

            let session = Session::builder()
                .map_err(|e| format!("session builder: {e}"))?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| format!("optimisation level: {e}"))?
                .with_intra_threads(4)
                .map_err(|e| format!("threads: {e}"))?
                .commit_from_memory(MODEL_ONNX)
                .map_err(|e| format!("model load: {e}"))?;

            Ok(Mutex::new(Embedder { session, tokenizer }))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Embed a batch. `kind` selects whether the query instruction is applied.
fn embed_batch(texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    if texts.len() > MAX_BATCH {
        return Err(format!(
            "too many texts in one call: {} (limit {MAX_BATCH})",
            texts.len()
        ));
    }

    let prepared: Vec<String> = texts
        .iter()
        .map(|t| {
            let trimmed: String = t.chars().take(MAX_CHARS).collect();
            if is_query {
                format!("{QUERY_INSTRUCTION}{trimmed}")
            } else {
                trimmed
            }
        })
        .collect();

    let lock = embedder()?;
    let mut guard = lock.lock().map_err(|_| "embedder lock poisoned".to_string())?;
    let Embedder { session, tokenizer } = &mut *guard;

    let encodings = tokenizer
        .encode_batch(prepared, true)
        .map_err(|e| format!("tokenize: {e}"))?;
    let batch = encodings.len();
    let seq = encodings
        .iter()
        .map(|e| e.get_ids().len())
        .max()
        .unwrap_or(0)
        .max(1);

    // Flat row-major buffers. ort accepts (shape, Vec), which keeps this code
    // independent of whichever ndarray version ort happens to depend on.
    let mut ids = vec![0i64; batch * seq];
    let mut mask = vec![0i64; batch * seq];
    let types = vec![0i64; batch * seq];
    for (i, e) in encodings.iter().enumerate() {
        for (j, (&id, &m)) in e.get_ids().iter().zip(e.get_attention_mask()).enumerate() {
            ids[i * seq + j] = id as i64;
            mask[i * seq + j] = m as i64;
        }
    }

    let outputs = session
        .run(ort::inputs![
            "input_ids" => Tensor::from_array(([batch, seq], ids)).map_err(|e| e.to_string())?,
            "attention_mask" => Tensor::from_array(([batch, seq], mask)).map_err(|e| e.to_string())?,
            "token_type_ids" => Tensor::from_array(([batch, seq], types)).map_err(|e| e.to_string())?,
        ])
        .map_err(|e| format!("inference: {e}"))?;

    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("read output: {e}"))?;
    let seq_len = shape[1] as usize;
    let dim = shape[2] as usize;
    if dim != EMBED_DIM {
        return Err(format!("model returned {dim} dimensions, expected {EMBED_DIM}"));
    }

    let mut out = Vec::with_capacity(batch);
    for b in 0..batch {
        // CLS pooling: the first token's hidden state IS the sentence vector for
        // this model family. Mean pooling is what a different family wants; using
        // the wrong one quietly degrades every result rather than failing.
        let start = b * seq_len * dim;
        let mut v = data[start..start + dim].to_vec();

        // L2-normalise, so downstream cosine similarity is a plain dot product.
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-12 {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
        out.push(v);
    }
    Ok(out)
}

#[tauri::command]
pub async fn embed_texts(texts: Vec<String>, kind: Option<String>) -> Result<Vec<Vec<f32>>, String> {
    let is_query = kind.as_deref() == Some("query");
    // Inference is CPU-bound and would otherwise block the async runtime while
    // a batch runs.
    tauri::async_runtime::spawn_blocking(move || embed_batch(&texts, is_query))
        .await
        .map_err(|e| format!("embedding task failed: {e}"))?
}

/// Whether embedding is usable, so the UI can say so rather than silently
/// falling back to keyword search the way the old CDN version did.
#[tauri::command]
pub fn embed_available() -> bool {
    embedder().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cosine(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| x * y).sum()
    }

    #[test]
    fn produces_normalised_vectors_of_the_expected_width() {
        let v = embed_batch(&["a short passage about permissions".into()], false).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].len(), EMBED_DIM);
        let norm = v[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "expected unit length, got {norm}");
    }

    #[test]
    fn ranks_a_relevant_passage_above_an_unrelated_one() {
        // The property that matters. If this fails, retrieval is worthless
        // regardless of what the rest of the pipeline does.
        let query = embed_batch(
            &["how do I stop a shell command that hangs forever".into()],
            true,
        )
        .unwrap();
        let passages = embed_batch(
            &[
                "Kill the child process once its timeout expires so a run cannot hang.".into(),
                "Fold the butter into the flour until the pastry just comes together.".into(),
            ],
            false,
        )
        .unwrap();

        let relevant = cosine(&query[0], &passages[0]);
        let unrelated = cosine(&query[0], &passages[1]);
        assert!(
            relevant > unrelated + 0.1,
            "relevant {relevant:.3} should clearly beat unrelated {unrelated:.3}"
        );
    }

    #[test]
    fn an_absolute_similarity_threshold_would_be_meaningless() {
        // Guards the reasoning in PROVENANCE.md. BGE similarities sit in a high,
        // compressed band: unrelated text still scores well above the 0.32 cut-off
        // the previous keyword-era code used. If someone reintroduces a threshold,
        // this test is where they find out why it cannot work.
        let query = embed_batch(&["how do I stop a runaway command".into()], true).unwrap();
        let unrelated = embed_batch(
            &["Fold the butter into the flour until the pastry comes together.".into()],
            false,
        )
        .unwrap();
        assert!(
            cosine(&query[0], &unrelated[0]) > 0.32,
            "unrelated text scoring under 0.32 would mean the model changed; \
             re-measure the ranking assumptions in PROVENANCE.md"
        );
    }

    #[test]
    fn the_query_instruction_actually_changes_the_vector() {
        let text = "permission guard decisions".to_string();
        let as_query = embed_batch(&[text.clone()], true).unwrap();
        let as_passage = embed_batch(&[text], false).unwrap();
        assert!(
            cosine(&as_query[0], &as_passage[0]) < 0.999,
            "query and passage encodings should differ — the instruction prefix is not being applied"
        );
    }

    #[test]
    fn refuses_an_oversized_batch_instead_of_exhausting_memory() {
        let many: Vec<String> = (0..MAX_BATCH + 1).map(|i| format!("text {i}")).collect();
        assert!(embed_batch(&many, false).unwrap_err().contains("too many"));
    }

    #[test]
    fn an_empty_batch_is_not_an_error() {
        assert!(embed_batch(&[], false).unwrap().is_empty());
    }
}
