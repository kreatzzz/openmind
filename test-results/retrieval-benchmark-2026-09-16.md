# Encrypted lexical retrieval benchmark

Measured September 16, 2026 on Windows 11 Pro 10.0.26200, an Intel Core i9-14900K (24 cores, 32 logical processors), 31.7 GiB RAM, and Rust 1.98.0.

The benchmark uses the debug test build, one encrypted SQLCipher vault, FTS5 `unicode61`, synthetic short memory records, an exact unique-term lookup, and 20 warm queries at each cumulative size. `vault files` is the combined size of the database, WAL, and shared-memory files while open.

| Records | Warm p50 | Warm p95 | Vault files |
| ---: | ---: | ---: | ---: |
| 1,000 | 88 µs | 597 µs | 1,309,160 bytes |
| 10,000 | 101 µs | 432 µs | 21,148,760 bytes |
| 100,000 | 123 µs | 966 µs | 205,056,264 bytes |

Run with:

```powershell
. .\scripts\windows-env.ps1
Set-Location .\src-tauri
cargo test --no-default-features retrieval_benchmark_at_1k_10k_and_100k_records -- --ignored --nocapture
```

These numbers cover warm lexical lookup only. They do not measure cold startup, RAM, query embedding latency, exact vector scan latency at scale, macOS, representative natural-language match distributions, extraction quality, or clinical behavior. The dataset is synthetic and the result is an engineering measurement, not a clinical evaluation.
