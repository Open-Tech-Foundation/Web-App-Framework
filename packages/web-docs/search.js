// DOM-free reader for the OTF Search binary format.
/** @typedef {{ limit?: number, maxSectionsPerPage?: number, signal?: AbortSignal }} SearchOptions */
/** @typedef {{ url: string, title: string, text: string, section: string, excerpt: string, highlights: number[][], meta: Record<string, string>, anchors: Array<{ id: string, text: string, pos: number }>, score: number }} SearchResult */
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
// Build a prose-only preview within the selected section. Original offsets remain
// untouched in the index; omission ranges are mapped only for card rendering.
function excerptFor(fragment, groups, match) {
  const { text, anchors = [], excerptOmit = [] } = fragment;
  const sectionStart = match?.anchor?.pos ?? 0;
  const sectionEnd = anchors.filter((anchor) => anchor.pos > sectionStart).sort((a, b) => a.pos - b.pos)[0]?.pos ?? text.length;
  let source = sectionStart, clean = "", position = 0;
  const target = match?.position ?? sectionStart;
  const append = (end) => {
    if (target >= source) position = clean.length + Math.min(target - source, end - source);
    clean += text.slice(source, end);
    source = end;
  };
  for (const [from, to] of [...excerptOmit].sort((a, b) => a[0] - b[0])) {
    if (to <= source || from >= sectionEnd) continue;
    append(Math.max(source, from));
    source = Math.min(to, sectionEnd);
  }
  append(sectionEnd);
  position = clean.slice(0, position).replace(/\s+/g, " ").length;
  clean = clean.replace(/\s+/g, " ");
  const start = Math.max(0, clean.lastIndexOf(" ", Math.max(0, position - 70)) + 1);
  let end = Math.min(clean.length, start + 220);
  const boundary = clean.indexOf(" ", end);
  if (boundary >= 0) end = boundary;
  const excerpt = clean.slice(start, end).trim(), highlights = [];
  // Highlight complete visible words; normalization handles accents and identifiers
  // without using normalized string offsets against the original display text.
  for (const word of excerpt.matchAll(/[\p{L}\p{N}\p{M}_.-]+/gu)) {
    const variants = wordGroups(word[0])[0] || [];
    if (groups.some((group) => variants.some((variant) => variant.startsWith(group[0]) ||
      variant.startsWith(group[0].normalize("NFD").replace(/\p{M}/gu, ""))))) {
      highlights.push([word.index, word.index + word[0].length]);
    }
  }
  return { excerpt, highlights };
}
// Render highlighted excerpts as text nodes and <mark>, never injected HTML.
export function excerptParts(excerpt, highlights = []) {
  const parts = [];
  let position = 0;
  for (const [start, end] of [...highlights].sort((a, b) => a[0] - b[0])) {
    if (start < position || end <= start || end > excerpt.length) continue;
    if (start > position) parts.push({ text: excerpt.slice(position, start), match: false });
    parts.push({ text: excerpt.slice(start, end), match: true });
    position = end;
  }
  if (position < excerpt.length) parts.push({ text: excerpt.slice(position), match: false });
  return parts;
}
// Posting offsets already account for Unicode normalization and identifier variants.
// Rank distinct sections, keeping the link and excerpt at the same location.
// When query words only match across separate sections, keep the best page card
// rather than presenting every incomplete section as a complete query match.
function sectionMatches(fragment, groups, fieldWeights) {
  const anchors = (fragment.anchors || []).filter((anchor) => anchor.id).sort((a, b) => a.pos - b.pos);
  const sections = new Map();
  groups.forEach((positions, group) => {
    for (const [position, field] of positions) {
      const anchor = anchors.findLast((anchor) => anchor.pos <= position);
      const key = anchor?.id || "";
      if (!sections.has(key)) sections.set(key, { anchor, weights: new Map(), position, weight: 0 });
      const section = sections.get(key), weight = fieldWeights[field];
      section.weights.set(group, Math.max(section.weights.get(group) || 0, weight));
      if (weight > section.weight || (weight === section.weight && position < section.position)) {
        section.position = position;
        section.weight = weight;
      }
    }
  });
  const ranked = [...sections.values()].sort((a, b) => b.weights.size - a.weights.size ||
    [...b.weights.values()].reduce((sum, weight) => sum + weight, 0) - [...a.weights.values()].reduce((sum, weight) => sum + weight, 0) ||
    a.position - b.position);
  return ranked[0]?.weights.size === groups.length ? ranked.filter(section => section.weights.size === groups.length) : ranked.slice(0, 1);
}
/**
 * Create a reusable client for one static `_search/` directory.
 * `limit` bounds cards; `total` counts matching pages. Each page's best section
 * comes first, then more matches, up to `maxSectionsPerPage` (default 3).
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
    async query(query, { limit = 10, maxSectionsPerPage = 3, signal } = {}) {
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
      const scores = new Map(), matches = new Map(), locations = new Map(), matchedPositions = new Map();
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
            const previous = best.get(doc);
            if (!previous) best.set(doc, { score, positions: [...positions] });
            else {
              previous.score = Math.max(previous.score, score);
              // Prefix and identifier alternatives can match different sections.
              // Keep every location while counting this query word only once.
              previous.positions.push(...positions);
            }
          }
        }
        for (const [doc, { score, positions }] of best) {
          positions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          scores.set(doc, (scores.get(doc) || 0) + score);
          matches.set(doc, (matches.get(doc) || 0) + 1);
          const perDoc = locations.get(doc) || [];
          perDoc.push(positions.map(([position]) => position)); locations.set(doc, perDoc);
          const perDocMatches = matchedPositions.get(doc) || [];
          perDocMatches.push(positions); matchedPositions.set(doc, perDocMatches);
        }
      });
      for (const [doc, groups] of locations) if (groups.length >= 2) {
        const points = groups.map((group) => group[0]).sort((a, b) => a - b);
        scores.set(doc, scores.get(doc) + 1 / (1 + points.at(-1) - points[0]));
      }
      let ranked = [...scores].filter(([doc]) => matches.get(doc) === groups.length);
      const partial = ranked.length === 0 && scores.size > 0;
      if (partial) ranked = [...scores];
      const resultLimit = Math.max(0, Math.floor(limit));
      const sectionLimit = Number.isFinite(maxSectionsPerPage) ? Math.max(1, Math.floor(maxSectionsPerPage)) : 3;
      const top = ranked.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, resultLimit);
      throwIfAborted(signal);
      const pages = await Promise.all(top.map(async ([doc, score]) => {
        const fragment = await (await fetchIndex(`${state.manifest.fragmentsDir || "f"}/${doc}.json`, { signal })).json();
        return sectionMatches(fragment, matchedPositions.get(doc) || [], fieldWeights).slice(0, sectionLimit).map(match => {
          const url = match.anchor ? `${fragment.url.split("#")[0]}#${encodeURIComponent(match.anchor.id)}` : fragment.url;
          return { ...fragment, url, section: match.anchor?.text || "", ...excerptFor(fragment, groups, match), score };
        });
      }));
      throwIfAborted(signal);
      // Give each relevant page its best card before adding more sections.
      const results = [];
      for (let section = 0; section < Math.min(sectionLimit, resultLimit); section++) {
        for (const page of pages) {
          if (page[section]) results.push(page[section]);
          if (results.length === resultLimit) break;
        }
        if (results.length === resultLimit) break;
      }
      return { results, total: ranked.length, partial };
    },
  };
}
