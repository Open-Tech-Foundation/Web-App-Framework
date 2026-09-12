# OTF Search plan

## Complete

- [x] Phase 1: deterministic HTML crawl, extraction, JSON index, headless reader,
  docs build hook, and internal `inspect` / `query` commands.
- [x] Baseline tokenizer fixture and Rust extraction/URL tests.

## Next

- [ ] Phase 2: content-addressed manifest, varint docs table, front-coded term chunks,
  JS binary decoder, and golden deterministic fixtures.
- [ ] Phase 3: tokenizer parity, BM25, field weights, anchors, excerpts and highlights.
- [ ] Phase 4: prefix expansion, filters and AND-to-OR fallback.
- [ ] Phase 5: complete accessible component behaviour and public web-docs reader export.
- [ ] Phase 6: request/size budgets, deployment caching guidance, and ship the internal
  binary with the compiler artifacts.
