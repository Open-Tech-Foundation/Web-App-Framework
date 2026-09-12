// Headless binary search reader. Kept DOM-free so the docs modal is only one consumer.
/** @typedef {{ limit?: number, filters?: Record<string, string>, signal?: AbortSignal }} SearchOptions */
/** @typedef {{ url: string, title: string, text: string, meta: Record<string, string>, anchors: Array<{ id: string, text: string, pos: number }>, score: number }} SearchResult */
/**
 * Create a reusable search client for one static `_search/` directory.
 * @param {{ base?: string }} options
 * @returns {{ preload(): Promise<Map<string, Array<[number, number]>>>, query(query: string, options?: SearchOptions): Promise<{ results: SearchResult[], total: number, partial: boolean }> }}
 */
export function createSearch({ base = "/_search/" } = {}) {
  const root = base.replace(/\/$/, "");
  let initialized;
  let loading;
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
  const load = () => (loading ||= init().then(async (state) => {
    const file = state?.manifest?.chunks?.[0]?.file;
    if (!file) throw new Error("Search index has no term chunks");
    const bytes = new Uint8Array(await fetch(`${root}/${file}`).then((r) => {
      if (!r.ok) throw new Error(`Search term chunk unavailable (${r.status})`);
      return r.arrayBuffer();
    }));
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== "OTFI" || bytes[4] !== 1) throw new Error("Unsupported search term chunk");
    let p = 5; const read = () => { let n = 0, s = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; };
    const count = read(), rows = [], decoder = new TextDecoder(); let previous = new Uint8Array();
    for (let i = 0; i < count; i++) { const prefix = read(), len = read(), suffix = bytes.slice(p, p + len); p += len; const termBytes = new Uint8Array(prefix + len); termBytes.set(previous.subarray(0, prefix)); termBytes.set(suffix, prefix); const term = decoder.decode(termBytes); rows.push([term, read(), read()]); previous = termBytes; }
    const postings = new Map(); const blob = p;
    for (const [term, df, offset] of rows) { let q = blob + offset, doc = 0, list = []; for (let i = 0; i < df; i++) { const next = () => { let n = 0, s = 0, b; do { b = bytes[q++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; }; doc += next(); const tf = next(); for (let j = 0; j < tf; j++) next(); list.push([doc, tf]); } postings.set(term, list); }
    return postings;
  }));
  return {
    preload: load,
    /** @param {string} query @param {SearchOptions} options */
    async query(query, { limit = 10, signal } = {}) {
      throwIfAborted(signal);
      const postings = await load();
      throwIfAborted(signal);
      const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])];
      if (!words.length) return { results: [], total: 0, partial: false };
      const scores = new Map();
      const matches = new Map();
      for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        const word = words[wordIndex];
        // The trailing word is an as-you-type prefix. Expansion is bounded and ordered
        // by document frequency, so a broad prefix cannot dominate a query.
        const candidates = wordIndex === words.length - 1
          ? [...postings.entries()].filter(([term]) => term.startsWith(word)).sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0])).slice(0, 32)
          : [[word, postings.get(word) || []]];
        const seen = new Set();
        for (const [, list] of candidates) for (const [doc, tf] of list) {
          if (seen.has(doc)) continue;
          seen.add(doc);
        scores.set(doc, (scores.get(doc) || 0) + tf);
          matches.set(doc, (matches.get(doc) || 0) + 1);
        }
      }
      let ranked = [...scores].filter(([doc]) => matches.get(doc) === words.length);
      const partial = ranked.length === 0;
      if (partial) ranked = [...scores];
      const top = ranked.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
      throwIfAborted(signal);
      const results = await Promise.all(top.map(async ([doc, score]) => ({ ...(await fetch(`${root}/f/${doc}.json`, { signal }).then((r) => r.json())), score })));
      return { results, total: ranked.length, partial };
    },
  };
}
