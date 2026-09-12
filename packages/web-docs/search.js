// Phase-1 headless reader. Kept DOM-free so the docs modal is only one consumer.
export function createSearch({ base = "/_search/" } = {}) {
  const root = base.replace(/\/$/, "");
  let initialized;
  let loading;
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
  const load = () => (loading ||= init().then(() => fetch(`${root}/index.json`).then((r) => {
    if (!r.ok) throw new Error(`Search index unavailable (${r.status})`);
    return r.json();
  })));
  return {
    preload: init,
    async query(query, { limit = 10, signal } = {}) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = await load();
      const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
      if (!words.length) return { results: [], total: 0, partial: false };
      const scores = new Map();
      for (const word of words) for (const [doc, tf] of index.terms[word] || []) scores.set(doc, (scores.get(doc) || 0) + tf);
      const results = [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([doc, score]) => ({ ...index.docs[doc], score }));
      return { results, total: scores.size, partial: false };
    },
  };
}
