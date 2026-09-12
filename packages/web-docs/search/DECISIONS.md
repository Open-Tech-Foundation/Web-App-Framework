# OTF Search decisions

## 2026-09-12 — Internal ownership

The Rust binary is an internal target of `otfw_cli`; the reader and UI are owned by
`@opentf/web-docs`. Neither is a separately published search package.

## 2026-09-12 — Source material

Search indexes static HTML emitted by SSG, rather than OTF Web's route/content model.
This keeps indexing independent of authoring format and lets it cover docs and blog
pages uniformly.

## 2026-09-12 — Phase 1 transport

The first working transport is one JSON file. It remains only as the compatibility
fallback while the binary reader and writer are introduced together.
