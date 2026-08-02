# bge-small-en-v1.5 — bundled embedding model

HashCortx ships this model so the knowledge base works with the network off and
nothing you index ever leaves your machine. It is inference-only: a fixed,
pre-trained sentence-embedding model, not a language model.

## What is here

| File | Size | What it is |
|---|---|---|
| `model_quantized.onnx` | 34.0 MB | The weights, int8-quantised, ONNX format |
| `tokenizer.json` | 711 KB | WordPiece vocabulary and normalisation rules |
| `config.json` | 683 B | Architecture: BERT, 12 layers, 384 hidden |
| `tokenizer_config.json` | 366 B | Lower-casing and max-length settings |

`model_quantized.onnx` SHA-256:

```
6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4
```

## Where it came from

- Original model: [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) — **MIT licence**
- ONNX conversion: [Xenova/bge-small-en-v1.5](https://huggingface.co/Xenova/bge-small-en-v1.5), file `onnx/model_quantized.onnx`

MIT is compatible with this repository's own MIT licence. The licence text is in
`LICENSE` next to this file.

## How it is used

`src-tauri/src/commands/embed.rs` runs it through ONNX Runtime, natively, in the
Rust process — not in the web view. Two details are not free choices, they are
what this particular model was trained for:

- **CLS pooling.** The sentence vector is the first token's hidden state, not the
  mean of all of them. BAAI's reference implementation uses CLS; the mean is what
  a different family of models wants.
- **A query instruction prefix.** Query text is prefixed with
  `Represent this sentence for searching relevant passages: ` before embedding.
  Stored passages are embedded bare. Embedding both sides the same way measurably
  costs recall on BGE models.

## Why a similarity threshold is the wrong tool here

Measured with this exact file, for the query *"how do I stop a shell command that
hangs forever"*:

| Passage | Cosine |
|---|---|
| Killing a child process when its timeout expires | 0.68 |
| An unrelated sentence from the same document | 0.44 |
| A sentence about pastry | **0.41** |

Unrelated text scores 0.41. BGE similarities sit in a compressed, high band, so
any fixed cut-off is either meaningless or arbitrary — the previous code used
0.32, which this model would pass for absolutely everything. Ranking, and fusing
those ranks with the keyword ranking, is what actually separates results. Do not
reintroduce an absolute threshold without re-measuring against numbers like these.

## Replacing it

Swapping the model is a change to `EMBED_*` in `embed.rs` plus these files. Match
the dimension (384) or the stored vectors of every existing user become
meaningless, and re-check the pooling mode and query prefix against whatever the
new model was trained with — they are not interchangeable between families.
