# OTF Search tokenizer

This document is normative. Rust indexing and JavaScript querying must satisfy the same
`tokenizer-vectors.json` fixture before a binary index is enabled by default.

1. Segment with UAX#29 word boundaries.
2. Apply NFKC normalization and lowercase.
3. Emit both the normalized token and a diacritic-folded variant when they differ.
4. For identifiers, retain the full token and emit camel-case, snake-case, kebab-case,
   and dotted-path parts at 0.6 field weight.
5. Discard terms longer than 64 UTF-8 bytes. Do not remove stop words or stem terms.
6. A CJK run left intact by word segmentation produces overlapping bigrams.

Token positions are positions in the normalized, whitespace-collapsed fragment text.
