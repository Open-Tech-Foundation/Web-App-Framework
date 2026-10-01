// DOM-free reader for the OTF Search binary format.
/** @typedef {{ limit?: number, signal?: AbortSignal }} SearchOptions */
/** @typedef {{ url: string, title: string, text: string, excerpt: string, highlights: number[][], meta: Record<string, string>, anchors: Array<{ id: string, text: string, pos: number }>, score: number }} SearchResult */
const encoder = new TextEncoder();
// Rust's String ordering is UTF-8 byte ordering, not locale collation.
function compare(a, b) {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function cursor(bytes, position = 0) {
  return {
    position,
    read() {
      let value = 0;
      for (let shift = 0; shift <= 49; shift += 7) {
        if (this.position >= bytes.length) throw new Error("Truncated search index");
        const byte = bytes[this.position++];
        value += (byte & 127) * 2 ** shift;
        if (!Number.isSafeInteger(value)) throw new Error("Invalid search integer");
        if (!(byte & 128)) return value;
      }
      throw new Error("Invalid search integer");
    },
  };
}
function decodeChunk(bytes) {
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "OTFI" || bytes[4] !== 1) throw new Error("Unsupported search term chunk");
  const input = cursor(bytes, 5), count = input.read(), rows = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let previous = new Uint8Array();
  for (let i = 0; i < count; i++) {
    const prefix = input.read(), length = input.read();
    if (prefix > previous.length || length > bytes.length - input.position) throw new Error("Invalid search term table");
    const term = new Uint8Array(prefix + length);
    term.set(previous.subarray(0, prefix));
    term.set(bytes.subarray(input.position, input.position + length), prefix);
    input.position += length;
    rows.push([decoder.decode(term), input.read(), input.read()]);
    previous = term;
  }
  const postings = new Map(), blob = input.position;
  for (const [term, count, offset] of rows) {
    const list = [], input = cursor(bytes, blob + offset);
    let doc = 0;
    for (let i = 0; i < count; i++) {
      doc += input.read();
      const tf = input.read(), positions = [];
      let position = 0;
      for (let j = 0; j < tf; j++) {
        const packed = input.read();
        position += Math.floor(packed / 8);
        positions.push([position, packed % 8]);
      }
      list.push([doc, tf, positions]);
    }
    postings.set(term, list);
  }
  return postings;
}
function wordGroups(text) {
  return (text.match(/[\p{L}\p{N}\p{M}_.-]+/gu) || []).map((word) => {
    const normalized = word.normalize("NFKC"), whole = normalized.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(whole)) return [];
    const folded = whole.normalize("NFD").replace(/\p{M}/gu, "");
    const parts = normalized.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_.\-\s]+/).filter(Boolean).map((part) => part.toLowerCase());
    return [...new Set([whole, folded, ...parts])];
  }).filter((group) => group.length);
}
export function tokenize(text) {
  return [...new Set(wordGroups(text).flat())];
}
function excerptFor(text, terms) {
  const lower = text.toLowerCase();
  let start = text.length;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0) start = Math.min(start, at);
  }
  if (start === text.length) return { excerpt: text.slice(0, 180), highlights: [] };
  start = Math.max(0, text.lastIndexOf(" ", Math.max(0, start - 70)) + 1);
  let end = Math.min(text.length, start + 220);
  const boundary = text.indexOf(" ", end);
  if (boundary >= 0) end = boundary;
  const excerpt = text.slice(start, end), excerptLower = excerpt.toLowerCase(), highlights = [];
  for (const term of terms) {
    let at = 0;
    while ((at = excerptLower.indexOf(term, at)) >= 0) { highlights.push([at, at + term.length]); at += term.length; }
  }
  return { excerpt, highlights };
}
/**
 * Create a reusable client for one static `_search/` directory.
 * @param {{ base?: string }} options
 * @returns {{ preload(): Promise<void>, query(query: string, options?: SearchOptions): Promise<{ results: SearchResult[], total: number, partial: boolean }> }}
 */
export function createSearch({ base = "/_search/" } = {}) {
  const root = base.replace(/\/$/, "");
  let initialized;
  const chunkCache = new Map();
  const throwIfAborted = (signal) => {
    if (signal?.aborted) throw new DOMException("Search query aborted", "AbortError");
  };
  const fetchIndex = async (path, options) => {
    const response = await fetch(`${root}/${path}`, options);
    if (!response.ok) {
      if (response.status === 404 && path !== "manifest.json") { initialized = undefined; chunkCache.clear(); }
      throw new Error(`Search index unavailable (${response.status})`);
    }
    return response;
  };
  const init = () => (initialized ||= (async () => {
    const manifest = await (await fetchIndex("manifest.json", { cache: "no-cache" })).json();
    if (manifest.v !== undefined && manifest.v !== 1) throw new Error("Unsupported search index version");
    if (!Array.isArray(manifest.chunks) || !manifest.docsFile) throw new Error("Invalid search manifest");
    for (let i = 1; i < manifest.chunks.length; i++) {
      if (compare(manifest.chunks[i - 1].first, manifest.chunks[i].first) >= 0) throw new Error("Unsorted search shards");
    }
    const bytes = new Uint8Array(await (await fetchIndex(manifest.docsFile)).arrayBuffer());
    const input = cursor(bytes), lengths = [];
    while (input.position < bytes.length) lengths.push(input.read());
    if (manifest.docs !== undefined && manifest.docs !== lengths.length) throw new Error("Invalid search document table");
    return { manifest, lengths };
  })().catch((error) => { initialized = undefined; throw error; }));
  const loadChunk = (file) => {
    if (!chunkCache.has(file)) chunkCache.set(file, fetchIndex(file).then((r) => r.arrayBuffer())
      .then((bytes) => decodeChunk(new Uint8Array(bytes)))
      .catch((error) => { chunkCache.delete(file); throw error; }));
    return chunkCache.get(file);
  };
  const findChunk = (chunks, term) => {
    let low = 0, high = chunks.length - 1, answer = 0;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (compare(chunks[mid].first, term) <= 0) { answer = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return answer;
  };
  return {
    async preload() { await init(); },
    async query(query, { limit = 10, signal } = {}) {
      throwIfAborted(signal);
      const groups = wordGroups(query);
      if (!groups.length) return { results: [], total: 0, partial: false };
      const state = await init(), { chunks } = state.manifest;
      if (!chunks.length && !state.lengths.length) return { results: [], total: 0, partial: false };
      if (!chunks.length) throw new Error("Search index has no term chunks");
      const selected = new Set();
      groups.forEach((group, groupIndex) => group.forEach((word) => {
        const index = findChunk(chunks, word);
        selected.add(chunks[index].file);
        // Prefixes can span more than two shards.
        if (groupIndex === groups.length - 1) {
          for (let i = index + 1; i < chunks.length && chunks[i].first.startsWith(word); i++) selected.add(chunks[i].file);
        }
      }));
      const postings = new Map();
      for (const shard of await Promise.all([...selected].map(loadChunk))) for (const [term, list] of shard) postings.set(term, list);
      throwIfAborted(signal);
      const scores = new Map(), matches = new Map(), locations = new Map();
      const totalDocs = state.lengths.length, avgdl = state.manifest.avgdl || 1;
      const fieldWeights = [8, 5, 4, 2.5, 3, 2, 1, 0.5];
      groups.forEach((group, groupIndex) => {
        const best = new Map();
        const candidates = [...postings].filter(([term]) => group.some((word) => term === word ||
          (groupIndex === groups.length - 1 && term.startsWith(word))))
          .sort((a, b) => Number(group.includes(b[0])) - Number(group.includes(a[0])) || a[1].length - b[1].length || compare(a[0], b[0])).slice(0, 32);
        for (const [term, list] of candidates) {
          const idf = Math.log(1 + (totalDocs - list.length + 0.5) / (list.length + 0.5));
          for (const [doc, tf, positions] of list) {
            if (doc >= totalDocs || !tf) throw new Error("Invalid search posting");
            const weight = Math.max(...positions.map(([, field]) => fieldWeights[field]));
            const exact = term === group[0] ? 4 : group.includes(term) ? 0.75 : 0.5;
            const score = exact * weight * idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * state.lengths[doc] / avgdl));
            if (!best.has(doc) || best.get(doc).score < score) best.set(doc, { score, positions });
          }
        }
        for (const [doc, { score, positions }] of best) {
          scores.set(doc, (scores.get(doc) || 0) + score);
          matches.set(doc, (matches.get(doc) || 0) + 1);
          const perDoc = locations.get(doc) || [];
          perDoc.push(positions.map(([position]) => position)); locations.set(doc, perDoc);
        }
      });
      for (const [doc, groups] of locations) if (groups.length >= 2) {
        const points = groups.map((group) => group[0]).sort((a, b) => a - b);
        scores.set(doc, scores.get(doc) + 1 / (1 + points.at(-1) - points[0]));
      }
      let ranked = [...scores].filter(([doc]) => matches.get(doc) === groups.length);
      const partial = ranked.length === 0 && scores.size > 0;
      if (partial) ranked = [...scores];
      const top = ranked.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, Math.max(0, limit));
      throwIfAborted(signal);
      const results = await Promise.all(top.map(async ([doc, score]) => {
        const fragment = await (await fetchIndex(`${state.manifest.fragmentsDir || "f"}/${doc}.json`, { signal })).json();
        return { ...fragment, ...excerptFor(fragment.text, groups.flat()), score };
      }));
      throwIfAborted(signal);
      return { results, total: ranked.length, partial };
    },
  };
}
