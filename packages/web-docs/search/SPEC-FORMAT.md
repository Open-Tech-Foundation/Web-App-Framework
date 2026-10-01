# OTF Search index format

This is the normative format contract for the internal OTF Web docs search index.
Version 1 is the chunked binary format used by the Rust writer and JavaScript reader.
The CLI `inspect` and `query` commands read the same binary files; no `index.json`
is produced or required.

`_search/manifest.json` is revalidated on every deploy. Immutable payloads are named
by their content hash and must be served with one-year immutable caching.

```text
_search/
  manifest.json
  docs.<hash>.bin
  t/<hash>.bin
  f/<generation-hash>/<docid>.json
```

Term chunks start with `OTFI` followed by a one-byte format version and a varint term
count. Terms are lexicographically sorted and front-coded against their predecessor.
Each term table row stores prefix length, suffix length, suffix bytes, document
frequency, and relative posting offset. A posting is doc-id delta, position count, and
packed position deltas (`position_delta << 3 | field_class`). All integers are unsigned
LEB128 varints.

The manifest contains the corpus count, average document length, immutable document table and fragment generation
paths, and sorted chunk boundaries. A reader locates a term with a binary search for
the last chunk whose `first` is no greater than the term.

The `fragmentsDir` manifest field names the immutable fragment generation. Its hash
covers every fragment and document order, so a document ID cannot silently refer to
new content across deployments. Readers can use `f/` for older indexes without this
field. Hosts must revalidate `manifest.json`; hashed payloads can be cached immutably.
A missing old payload makes a query fail and causes the next query to reload the
manifest, rather than mix document generations.

Term ordering is UTF-8 byte ordering, independent of locale. Posting positions and
anchor `pos` values are UTF-16 offsets into each normalized document's `text`.
Normalization (NFKC, lowercase, accent folding, ASCII camelCase and separator
splitting) is shared by writer and reader. Variants of one word share a position
and count as alternatives for one query word. Prefix expansion is limited to the
last query word and can cross any number of matching chunks.

Pages opt in through `data-otf-search-body`. If any page opts in, unmarked pages
are excluded; otherwise the configured root selector (`main` by default) is used.
Nested roots do not duplicate content. `data-otf-search-ignore`, hidden regions and
navigation chrome are excluded. `data-otf-search-meta="key"` collects normalized
text and `data-otf-search-meta="key:value"` sets a literal value. Metadata can live
outside the indexed body. Pagefind attribute aliases remain readable for migration.

The current format includes titles, headings, code, body text, metadata and heading
anchors. Filter indexes are not implemented; the query API does not advertise filters.
