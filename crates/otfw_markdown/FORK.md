# `otfw_markdown` — a fork of markdown-rs

This crate is [markdown-rs](https://github.com/wooorm/markdown-rs) by Titus
Wormer, MIT licensed (`LICENSE-UPSTREAM`), vendored at **1.0.0** (crates.io
`markdown@1.0.0`, upstream commit `1506572f9b406431402928f3a8b3df0b4ae2d8f5`).
Its `[lib] name` is still `markdown`, so dependents rename it back:

```toml
markdown = { package = "otfw_markdown", path = "../otfw_markdown" }
```

Only `src/` is vendored — that is all crates.io ships (`include = ["src/",
"license"]`), so **upstream's conformance suite is not here**. Keep the delta
small and mechanical; the CommonMark/GFM/MDX behaviour is not ours to re-derive.

## Why fork at all

`otfwc` runs this parser on every `.mdx` page, and MDX parsing was superlinear
in page length — the failure the [SSG build
benchmark](../../benchmarks/ssg-build/README.md) chases. The cause is one
function, `util::edit_map::add_impl`.

## The delta

Every change is confined to `src/util/edit_map.rs` and marked `**OTF Web fork**`
in a comment. Run this to see it in full:

```bash
diff -ru ~/.cargo/registry/src/*/markdown-1.0.0/src crates/otfw_markdown/src
```

### `EditMap::add` was O(edits) per call

`EditMap` batches edits to the event list; `add_impl` scanned `map` from index 0
to find an edit already registered at the same position. `map` holds roughly one
entry per content chunk, so it grows with the document, and both `subtokenize`
and every construct's resolver call `add` — making parse time quadratic in
document length.

The fix adds a `BTreeMap<at, index>` beside `map` and looks the position up.
`map`'s order carries no meaning (`consume` sorts by `at`, and this very merge is
what keeps `at` values unique), so keying by `at` is an exact replacement — same
edits, same order out.

Measured with `to_mdast` under the parse options `mdx::mdx_to_jsx` uses,
1000 → 8000 repetitions of one construct:

| construct | before | after |
|---|---:|---:|
| GFM table rows | 13719 ms | 213 ms |
| headings | 737 ms | 104 ms |
| fenced code | 416 ms | 58 ms |
| list items | 908 ms | 150 ms |
| blockquotes | 415 ms | 93 ms |
| paragraphs | 235 ms | 128 ms |

End to end, `mdx_to_jsx` over a 74 KB → 2.4 MB MDX ladder goes from superlinear
(2.0 s at 1.2 MB, growing ~3× per doubling) to flat 2× per doubling.

## Retiring the fork

Upstream is unaware of this; 1.0.0 is the current release. If a later release
carries the fix, delete this crate and go back to `markdown = "…"` from
crates.io — nothing else in the tree depends on the fork.
