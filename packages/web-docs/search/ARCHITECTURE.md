# OTF Search architecture

The Rust `otf-search` binary crawls emitted HTML after SSG. It owns extraction,
tokenization, deterministic document IDs, and index encoding. `@opentf/web-docs` owns
the post-build hook, the DOM-free reader, and the optional modal component.

```text
SSG HTML → otf-search → _search/{manifest, docs, chunks, fragments}
                              ↓
                         headless reader → Search component
```

The reader never references the DOM and every fetch receives an optional AbortSignal.
The modal owns debouncing, focus, keyboard navigation, and safe rendering of excerpts.
