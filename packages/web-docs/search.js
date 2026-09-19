// Headless binary search reader. Kept DOM-free so the docs modal is only one consumer.
/** @typedef {{ limit?: number, filters?: Record<string, string>, signal?: AbortSignal }} SearchOptions */
/** @typedef {{ url: string, title: string, text: string, meta: Record<string, string>, anchors: Array<{ id: string, text: string, pos: number }>, score: number }} SearchResult */

function decodeChunk(bytes) {
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "OTFI" || bytes[4] !== 1) throw new Error("Unsupported search term chunk");
  let p = 5; const read = () => { let n = 0, s = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; };
  const count = read(), rows = [], decoder = new TextDecoder(); let previous = new Uint8Array();
  for (let i = 0; i < count; i++) { const prefix = read(), len = read(), suffix = bytes.slice(p, p + len); p += len; const termBytes = new Uint8Array(prefix + len); termBytes.set(previous.subarray(0, prefix)); termBytes.set(suffix, prefix); rows.push([decoder.decode(termBytes), read(), read()]); previous = termBytes; }
  const postings = new Map(), blob = p;
  for (const [term, df, offset] of rows) { let q = blob + offset, doc = 0, list = []; for (let i = 0; i < df; i++) { const next = () => { let n = 0, s = 0, b; do { b = bytes[q++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; }; doc += next(); const tf = next(), positions = []; let position = 0; for (let j = 0; j < tf; j++) { const packed = next(); position += packed >>> 3; positions.push([position, packed & 7]); } list.push([doc, tf, positions]); } postings.set(term, list); }
  return postings;
}
export function tokenize(text) {
  const out = [];
  for (const word of text.match(/[\p{L}\p{N}_.-]+/gu) || []) {
    const whole = word.normalize("NFKC").toLowerCase(); out.push(whole);
    const folded = whole.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); if (folded !== whole) out.push(folded);
    const parts = word.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_.\-\s]+/).filter(Boolean).map((part) => part.toLowerCase());
    for (const part of parts) if (part !== whole) out.push(part);
  }
  return [...new Set(out)];
}
function excerptFor(text, terms) {
  const lower = text.toLowerCase(); let start = text.length;
  for (const term of terms) { const at = lower.indexOf(term); if (at >= 0 && at < start) start = at; }
  if (start === text.length) return { excerpt: text.slice(0, 180), highlights: [] };
  start = Math.max(0, text.lastIndexOf(" ", Math.max(0, start - 70)) + 1);
  let end = Math.min(text.length, start + 220); const boundary = text.indexOf(" ", end); if (boundary >= 0) end = boundary;
  const excerpt = text.slice(start, end), excerptLower = excerpt.toLowerCase(), highlights = [];
  for (const term of terms) { let at = 0; while ((at = excerptLower.indexOf(term, at)) >= 0) { highlights.push([at, at + term.length]); at += term.length; } }
  return { excerpt, highlights };
}
/**
 * Create a reusable search client for one static `_search/` directory.
 * @param {{ base?: string }} options
 * @returns {{ preload(): Promise<Map<string, Array<[number, number]>>>, query(query: string, options?: SearchOptions): Promise<{ results: SearchResult[], total: number, partial: boolean }> }}
 */
export function createSearch({ base = "/_search/" } = {}) {
  const root = base.replace(/\/$/, "");
  let initialized;
  let loading;
  const chunkCache = new Map();
  let chunk;
  const readVarints = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const values = [];
    for (let i = 0; i < bytes.length;) {
      let value = 0;
      let shift = 0;
      for (;;) {
        const byte = bytes[i++];
        value += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) break;
        shift += 7;
      }
      values.push(value);
    }
    return values;
  };
  const throwIfAborted = (signal) => {
    if (signal?.aborted) throw new DOMException("Search query aborted", "AbortError");
  };
  const init = () => (initialized ||= fetch(`${root}/manifest.json`, { cache: "no-cache" }).then(async (response) => {
    // A pre-Phase-2 export remains usable during rolling deployments.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Search manifest unavailable (${response.status})`);
    const manifest = await response.json();
    const docs = await fetch(`${root}/${manifest.docsFile}`).then((r) => {
      if (!r.ok) throw new Error(`Search document table unavailable (${r.status})`);
      return r.arrayBuffer();
    });
    return { manifest, lengths: readVarints(docs) };
  }));
  const loadChunk = (file) => {
    if (!chunkCache.has(file)) chunkCache.set(file, fetch(`${root}/${file}`).then((r) => {
      if (!r.ok) throw new Error(`Search term chunk unavailable (${r.status})`);
      return r.arrayBuffer();
    }).then((buffer) => decodeChunk(new Uint8Array(buffer))));
    return chunkCache.get(file);
  };
  const findChunk = (chunks, term) => {
    let low = 0, high = chunks.length - 1, answer = 0;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (chunks[mid].first.localeCompare(term) <= 0) { answer = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return chunks[answer];
  };
  const load = () => (loading ||= init().then(async (state) => {
    const file = state?.manifest?.chunks?.[0]?.file;
    if (!file) throw new Error("Search index has no term chunks");
    return loadChunk(file);
  }));
  return {
    preload: load,
    /** @param {string} query @param {SearchOptions} options */
    async query(query, { limit = 10, signal } = {}) {
      throwIfAborted(signal);
      const words = tokenize(query);
      if (!words.length) return { results: [], total: 0, partial: false };
      const state = await init();
      const chunks = state?.manifest?.chunks || [];
      if (!chunks.length) throw new Error("Search index has no term chunks");
      const selectedByFile = new Map(words.map((word) => { const meta = findChunk(chunks, word); return [meta.file, meta]; }));
      // A trailing prefix can continue into the lexical successor chunk.
      const trailing = findChunk(chunks, words.at(-1));
      const trailingIndex = chunks.indexOf(trailing);
      if (trailingIndex + 1 < chunks.length) selectedByFile.set(chunks[trailingIndex + 1].file, chunks[trailingIndex + 1]);
      const selected = [...selectedByFile.values()];
      const loaded = await Promise.all(selected.map((meta) => loadChunk(meta.file)));
      const postings = new Map();
      for (const shard of loaded) for (const [term, list] of shard) postings.set(term, list);
      throwIfAborted(signal);
      const scores = new Map();
      const matches = new Map();
      const locations = new Map();
      const totalDocs = state.manifest.docs || state.lengths.length;
      const avgdl = state.manifest.avgdl || 1;
      const fieldWeights = [8, 5, 4, 2.5, 3, 2, 1, 0.5];
      for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        const word = words[wordIndex];
        // The trailing word is an as-you-type prefix. Expansion is bounded and ordered
        // by document frequency, so a broad prefix cannot dominate a query.
        const candidates = wordIndex === words.length - 1
          ? [...postings.entries()].filter(([term]) => term.startsWith(word)).sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0])).slice(0, 32)
          : [[word, postings.get(word) || []]];
        const seen = new Set();
        for (const [, list] of candidates) {
          const idf = Math.log(1 + (totalDocs - list.length + 0.5) / (list.length + 0.5));
          for (const [doc, tf, positions] of list) {
          if (seen.has(doc)) continue;
          seen.add(doc);
          const dl = state.lengths[doc] || avgdl;
          const fieldWeight = Math.max(...list.find(([candidate]) => candidate === doc)?.[2].map(([, field]) => fieldWeights[field]) || [1]);
          const bm25 = fieldWeight * idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * dl / avgdl));
          scores.set(doc, (scores.get(doc) || 0) + bm25);
          matches.set(doc, (matches.get(doc) || 0) + 1);
          const perDoc = locations.get(doc) || []; perDoc.push(positions.map(([position]) => position)); locations.set(doc, perDoc);
          }
        }
      }
      let ranked = [...scores].filter(([doc]) => matches.get(doc) === words.length);
      for (const [doc, groups] of locations) if (groups.length >= 2) { const points = groups.map((group) => group[0]).sort((a, b) => a - b); scores.set(doc, scores.get(doc) + 1 / (1 + points.at(-1) - points[0])); }
      const partial = ranked.length === 0;
      if (partial) ranked = [...scores];
      const top = ranked.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
      throwIfAborted(signal);
      const results = await Promise.all(top.map(async ([doc, score]) => { const fragment = await fetch(`${root}/f/${doc}.json`, { signal }).then((r) => r.json()); return { ...fragment, ...excerptFor(fragment.text, words), score }; }));
      return { results, total: ranked.length, partial };
    },
  };
}
