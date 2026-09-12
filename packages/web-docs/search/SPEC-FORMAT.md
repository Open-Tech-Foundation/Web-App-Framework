# OTF Search index format

This is the normative format contract for the internal OTF Web docs search index.
Version 1 is the chunked binary format. The current JSON `index.json` is a Phase 1
development artifact and is not version 1 of this format.

`_search/manifest.json` is revalidated on every deploy. Immutable payloads are named
by their content hash and must be served with one-year immutable caching.

```text
_search/
  manifest.json
  docs.<hash>.bin
  t/<hash>.bin
  f/<docid>.json
  filters.<hash>.bin
```

Term chunks start with `OTFI` followed by a one-byte format version and a varint term
count. Terms are lexicographically sorted and front-coded against their predecessor.
Each term table row stores prefix length, suffix length, suffix bytes, document
frequency, and relative posting offset. A posting is doc-id delta, position count, and
packed position deltas (`position_delta << 3 | field_class`). All integers are unsigned
LEB128 varints.

The manifest contains the corpus count, average document length, immutable docs/filter
filenames, and sorted chunk boundaries. A reader locates a term with a binary search for
the last chunk whose `first` is no greater than the term.
