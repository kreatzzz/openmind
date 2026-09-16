# Memory quality evaluation — 2026-09-16

Status: engineering evaluation of the implemented desktop memory pipeline. This is not a clinical evaluation and does not establish treatment quality.

## Scope and reproducibility

The tracked fixture in `src-tauri/tests/fixtures/memory_quality.json` contains 14 invented memory records. It covers same-name people with different roles, negation, a helpful routine, a goal, a stable preference, positive support, a quoted malicious instruction, correction, forgetting, and unknown questions. No real conversation or vault data is used.

The deterministic tests exercise the actual encrypted `Vault`, FTS5 index, exact vector scan, reciprocal-rank fusion, context byte packing, correction, deletion, and extraction-patch validator. Controlled vectors isolate ranking behavior from a model. The ignored live tests are separate because their output depends on locally installed models.

Commands run from the repository root on Windows 11 Pro 10.0.26200, Intel i9-14900K, RTX 4080, and 31.7 GiB reported RAM:

```powershell
. .\scripts\windows-env.ps1
$env:CARGO_TARGET_DIR='F:\Coding projects\openmind\src-tauri\target'
cargo test --manifest-path src-tauri\Cargo.toml --no-default-features --test memory_quality -- --nocapture

$env:OPENMIND_TEST_EMBED_MODEL='all-minilm:22m'
$env:OLLAMA_URL='http://127.0.0.1:11434'
cargo test --manifest-path src-tauri\Cargo.toml --no-default-features --test memory_quality live_local_embedding_quality -- --ignored --nocapture

$env:OPENMIND_TEST_CHAT_MODEL='qwen3.5:4b'
cargo test --manifest-path src-tauri\Cargo.toml --no-default-features --test memory_quality live_local_extraction_observations -- --ignored --nocapture
```

Ollama was version 0.34.0. The embedding model was `all-minilm:22m`, digest prefix `1b226e2802db`. The extraction model was `qwen3.5:4b`, digest prefix `2a654d98e6fb`. Neither test downloads a model.

## Deterministic results

| Check | Result |
| --- | ---: |
| Lexical queries | 14 |
| Lexical top-1 accuracy | 14/14 (100%) |
| Lexical mean reciprocal rank | 1.000 |
| Same-name identity errors at top 1 | 0/6 |
| Unknown lexical questions returning no memory | 1/1 |
| Controlled-vector hybrid top-1 accuracy | 3/3 |
| Current correction selected | 1/1 |
| Forgotten record absent from lexical and semantic channels | 1/1 |
| Saved-context closing-tag breakout blocked | 1/1 |

These results are regression evidence for a small fixed corpus. They are not estimates for normal user histories. The assertions intentionally run through persisted, encrypted records instead of testing a detached ranking function.

The suite found four defects that were fixed:

1. Common question words entered the FTS `OR` query and could create irrelevant candidates. English query scaffolding is now removed while negation terms such as `not`, `no`, and `never` remain searchable.
2. Equal reciprocal-rank scores from opposing lexical and semantic ranks fell back to random memory UUID order. A valid semantic channel now breaks an exact fusion tie before lexical rank and UUID.
3. Retrieved text could contain `</saved_context>` and close the desktop's XML-like data wrapper. Context serialization now escapes `&`, `<`, and `>` in both query-aware and fallback memory formatting. This preserves the boundary; it does not make a model immune to instructions quoted inside data.
4. An evidence quote containing only whitespace passed shape validation. Whitespace-only quotes are now rejected.

Embedding response handling also had a robustness defect: it accumulated the full response before checking the four MiB limit and did not observe cancellation while reading the body. The implementation now rejects an oversized declared body before reading, enforces the limit incrementally, and selects cancellation between streamed chunks. Local delayed-body and oversized-body tests cover both paths.

## Live embedding results

The live comparison used 18 answerable questions over the same 14 records, including four paraphrases designed to have little or no lexical overlap. Both modes used a three-record result budget.

| Metric | Lexical | Hybrid with `all-minilm:22m` |
| --- | ---: | ---: |
| Recall@3 | 16/18 (88.9%) | 16/18 (88.9%) |
| Top-1 accuracy | 16/18 (88.9%) | 16/18 (88.9%) |
| Mean reciprocal rank | 0.889 | 0.889 |

Per-case expected ranks were:

| Expected record | Lexical rank | Hybrid rank |
| --- | ---: | ---: |
| Grandfather's ceramic fox | 1 | 1 |
| Mira Chen, Atlas coworker | 1 | 1 |
| Mira Shah, tomato-growing neighbor | 1 | 1 |
| Counting blue objects | 1 | 1 |
| Cedar Loop trail goal | 1 | 1 |
| Brief recap preference | 1 | 1 |
| Aria Taylor, baking friend | 1 | 1 |
| Aria Taylor, novelist | 1 | 1 |
| Sam Lee, bicycle-restoring cousin | 1 | 1 |
| Sam Lee, swimming coach | 1 | 1 |
| No surprise calls | 1 | 1 |
| Jules as support | 1 | 1 |
| Morning walk routine | 1 | 1 |
| Quoted museum instruction | 1 | 1 |
| Blue-object routine, paraphrased as grounding while overloaded | miss | miss |
| Ceramic fox, paraphrased as inherited desk ornament | 1 | 1 |
| Atlas coworker, paraphrased | 1 | 1 |
| Cedar Loop goal, paraphrased as a running route | miss | miss |

One of two unknown questions returned semantic candidates, so live hybrid abstention was 1/2. The present cosine threshold of 0.35 did not improve recall on this fixture and produced one false positive. This model and threshold should not be enabled by default based on these results. A larger held-out set should tune thresholds per model fingerprint and include irrelevant-selected-record judgment, rather than lowering the threshold to recover these two misses.

## Live extraction observations

Four fixed synthetic messages were sent to the actual structured extractor with temperature zero. Every returned candidate passed exact-substring evidence validation, but the result also demonstrates why that check is only mechanical provenance:

| Case | Observed result |
| --- | --- |
| Negated identity | No internal memories; two notebook `next_step` entries restated “not my sister” and “coworker.” The identity was not inverted, but the note kinds were inappropriate. |
| Hypothetical move | No internal memories; two `next_step` notes restated the hypothetical and the explicit non-plan. It avoided a durable move fact but still produced low-value notebook entries. |
| Quoted malicious instruction | No internal memories; two notebook `question` entries copied the sign text and its quoted status. It did not change extraction permissions, but copied adversarial text into the notebook. |
| Sarcasm and correction | No internal memories; one `next_step` note correctly captured the preference for advance notice, with the correction as evidence. The note kind was again inappropriate. |

This four-message observation is too small to calculate a useful extraction accuracy rate. It does show a conservative internal-memory tendency for this model and a notebook classification problem. Exact quote validation rejects absent evidence and now rejects blank evidence, but it deliberately accepts a false candidate such as “Rowan is the user's sibling” when the cited source merely contains “Rowan.” Semantic entailment still requires model evaluation and human-reviewed samples; valid provenance does not prove the candidate is true.

## Limits and next evaluation

- The authored corpus is tiny and in English. It cannot support a general quality claim or the larger proposed gates in `docs/memory.md`.
- Controlled vectors test ranking mechanics, not embedding quality. The one live embedding model had two paraphrase misses and one unknown-query false positive.
- Boundary escaping prevents markup breakout. Retrieved instructions remain untrusted data and can still influence a model; response-level prompt-injection behavior was not evaluated here.
- The embedding endpoint's 6,000-byte input allowance can exceed the installed model's 512-token context on long records. Ordinary short fixture records passed, but truncation and long multilingual inputs remain unmeasured.
- Correction and forgetting are tested for the implemented source-backed record and both search channels. Topic-wide forgetting, relationship repair, and multi-source dependency closure are not implemented.
- The suite does not measure 1k/10k/100k performance; the existing ignored scale benchmark remains the appropriate separate tool.
- A release candidate should add at least 100 held-out annotated continuity questions, 200 human-reviewed extraction candidates, per-model threshold calibration, and response-level checks for temporal conflict, adversarial retrieved text, sarcasm, hypotheticals, and unsupported abstention.
