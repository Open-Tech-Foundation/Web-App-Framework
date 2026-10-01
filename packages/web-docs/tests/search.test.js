import { expect, test } from "../../web-cli/tests/harness.js";
import { createSearch, excerptParts } from "../search.js";

function varint(value) { const out = []; while (value >= 128) { out.push((value & 127) | 128); value >>= 7; } return [...out, value]; }
function binaryChunk(term, doc = 0) { return new Uint8Array([...new TextEncoder().encode("OTFI"), 1, ...varint(1), 0, ...varint(term.length), ...new TextEncoder().encode(term), 1, 0, doc, 1, 0]); }

test("queries a binary term chunk and expands the final prefix", async () => {
  // OTFI v1: one front-coded term, one posting (doc 0, tf 1, packed position 0).
  const chunk = binaryChunk("routing");
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("manifest.json")) return Response.json({ docsFile: "docs.bin", chunks: [{ first: "routing", file: "t/a.bin", terms: 1 }] });
    if (path.endsWith("docs.bin")) return new Response(new Uint8Array([1]));
    if (path.endsWith("t/a.bin")) return new Response(chunk);
    if (path.endsWith("f/0.json")) return Response.json({ url: "/guide/", title: "Routing", text: "Routing guide", meta: {}, anchors: [] });
    return new Response(null, { status: 404 });
  };
  try {
    const result = await createSearch({ base: "/_search/" }).query("rout");
    expect(result.partial).toBe(false);
    expect(result.results[0].url).toBe("/guide/");
  } finally { globalThis.fetch = original; }
});

test("rejects an already-aborted query before making a request", async () => {
  const controller = new AbortController();
  controller.abort();
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("fetch must not run"); };
  try { let error; try { await createSearch().query("routing", { signal: controller.signal }); } catch (e) { error = e; } expect(error?.message).toMatch("aborted"); }
  finally { globalThis.fetch = original; }
});

test("selects the lexical shard containing an exact term", async () => {
  const original = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url) => { const path = String(url); seen.push(path);
    if (path.endsWith("manifest.json")) return Response.json({ docsFile: "docs.bin", chunks: [{ first: "alpha", file: "t/a.bin", terms: 1 }, { first: "zebra", file: "t/z.bin", terms: 1 }] });
    if (path.endsWith("docs.bin")) return new Response(new Uint8Array([1]));
    if (path.endsWith("t/z.bin")) return new Response(binaryChunk("zebra"));
    if (path.endsWith("f/0.json")) return Response.json({ url: "/z/", title: "Zebra", text: "Zebra", meta: {}, anchors: [] });
    return new Response(null, { status: 404 });
  };
  try { const result = await createSearch().query("zebra"); expect(result.results[0].url).toBe("/z/"); expect(seen.some((path) => path.endsWith("t/z.bin"))).toBe(true); }
  finally { globalThis.fetch = original; }
});

test("extends a trailing prefix into the successor shard", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { const path = String(url);
    if (path.endsWith("manifest.json")) return Response.json({ docsFile: "docs.bin", chunks: [{ first: "alpha", file: "t/a.bin", terms: 1 }, { first: "routing", file: "t/r.bin", terms: 1 }] });
    if (path.endsWith("docs.bin")) return new Response(new Uint8Array([1]));
    if (path.endsWith("t/a.bin")) return new Response(binaryChunk("alpha"));
    if (path.endsWith("t/r.bin")) return new Response(binaryChunk("routing"));
    if (path.endsWith("f/0.json")) return Response.json({ url: "/routing/", title: "Routing", text: "Routing", meta: {}, anchors: [] });
    return new Response(null, { status: 404 });
  };
  try { const result = await createSearch().query("rout"); expect(result.results[0].url).toBe("/routing/"); }
  finally { globalThis.fetch = original; }
});

// Fixtures encode real posting positions and UTF-8 term lengths.
function termsChunk(entries) {
  const encoder = new TextEncoder(), table = [], blob = [];
  for (const [term, docs] of entries) {
    const bytes = encoder.encode(term);
    table.push(0, ...varint(bytes.length), ...bytes, ...varint(docs.length), ...varint(blob.length));
    let previous = 0;
    for (const [doc, position = 0, field = 6] of docs) {
      blob.push(...varint(doc - previous), 1, ...varint(position * 8 + field));
      previous = doc;
    }
  }
  return new Uint8Array([...encoder.encode("OTFI"), 1, ...varint(entries.length), ...table, ...blob]);
}
async function withIndex({ chunks, fragments, manifest = {}, override }, check) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url); seen.push(path);
    const replaced = await override?.(path);
    if (replaced) return replaced;
    if (path.endsWith("manifest.json")) return Response.json({ v: 1, docs: fragments.length, avgdl: 10, docsFile: "docs.bin", chunks: chunks.map(({ first, file }) => ({ first, file })), ...manifest });
    if (path.endsWith("docs.bin")) return new Response(new Uint8Array(fragments.map(() => 10)));
    const chunk = chunks.find(({ file }) => path.endsWith(file));
    if (chunk) return new Response(chunk.bytes);
    const match = /\/(\d+)\.json$/.exec(path);
    if (match && fragments[Number(match[1])]) return Response.json({ meta: {}, anchors: [], ...fragments[Number(match[1])] });
    return new Response(null, { status: 404 });
  };
  try { await check(createSearch(), seen); } finally { globalThis.fetch = original; }
}

test("accent and identifier variants are alternatives, not additional query words", async () => {
  await withIndex({ chunks: [{ first: "café", file: "t/a.bin", bytes: termsChunk([["café", [[0]]], ["usestate", [[1]]]]) }],
    fragments: [{ url: "/cafe/", title: "Café", text: "café" }, { url: "/state/", title: "State", text: "useState" }] }, async (search) => {
    expect((await search.query("café")).partial).toBe(false);
    const result = await search.query("useState");
    expect(result.partial).toBe(false);
    expect(result.results[0].url).toBe("/state/");
  });
});

test("locates Unicode shards using the writer's byte order", async () => {
  await withIndex({ chunks: [
    { first: "a", file: "t/a.bin", bytes: termsChunk([["a", [[0]]]]) },
    { first: "zoo", file: "t/z.bin", bytes: termsChunk([["zoo", [[0]]]]) },
    { first: "éclair", file: "t/e.bin", bytes: termsChunk([["éclair", [[1]]]]) },
  ], fragments: [{ url: "/z/", text: "zoo" }, { url: "/e/", text: "éclair" }] }, async (search, seen) => {
    expect((await search.query("éclair")).results[0].url).toBe("/e/");
    expect(seen.some((url) => url.endsWith("t/e.bin"))).toBe(true);
  });
});

test("prefix expansion crosses every matching shard", async () => {
  await withIndex({ chunks: [
    { first: "alpha", file: "t/a.bin", bytes: termsChunk([["alpha", [[0]]]]) },
    ...["routing-a", "routing-b", "routing-c"].map((term, doc) => ({ first: term, file: `t/${doc}.bin`, bytes: termsChunk([[term, [[doc]]]]) })),
  ], fragments: [0, 1, 2].map((doc) => ({ url: `/${doc}/`, text: "routing" })) }, async (search) => {
    expect((await search.query("routing")).total).toBe(3);
  });
});

test("uses immutable fragment generations and produces match-centered excerpts", async () => {
  const text = `${"Use unrelated introduction. ".repeat(30)}useState details at the end.`;
  await withIndex({ chunks: [{ first: "usestate", file: "t/a.bin", bytes: termsChunk([["usestate", [[0, text.indexOf("useState")]]]]) }],
    manifest: { fragmentsDir: "f/generation-a" }, fragments: [{ url: "/guide/", title: "Guide", text }] }, async (search, seen) => {
    const result = await search.query("useState");
    expect(result.results[0].excerpt.includes("useState details")).toBe(true);
    expect(seen.includes("/_search/f/generation-a/0.json")).toBe(true);
  });
});

test("malformed postings are rejected rather than returning corrupt results", async () => {
  const bytes = termsChunk([["routing", [[0]]]]);
  await withIndex({ chunks: [{ first: "routing", file: "t/a.bin", bytes: bytes.slice(0, -1) }],
    fragments: [{ url: "/", text: "routing" }] }, async (search) => {
    let error; try { await search.query("routing"); } catch (e) { error = e; }
    expect(error?.message).toMatch("Truncated");
  });
});

test("failed requests can be retried", async () => {
  let failed = false;
  await withIndex({ chunks: [{ first: "routing", file: "t/a.bin", bytes: termsChunk([["routing", [[0]]]]) }],
    fragments: [{ url: "/", text: "routing" }], override: (path) => {
      if (path.endsWith("manifest.json") && !failed) { failed = true; return new Response(null, { status: 503 }); }
    } }, async (search) => {
    let error; try { await search.query("routing"); } catch (e) { error = e; }
    expect(error?.message).toMatch("503");
    expect((await search.query("routing")).total).toBe(1);
  });
});

test("a valid empty corpus returns no results", async () => {
  await withIndex({ chunks: [], fragments: [] }, async (search) => {
    expect((await search.query("routing")).total).toBe(0);
  });
});


test("links to the strongest matching section and centers its excerpt there", async () => {
  const text = `Guide useState overview ${"Introduction filler. ".repeat(20)}State hook useState details`;
  const heading = text.indexOf("State hook"), match = text.lastIndexOf("useState");
  // Two occurrences: generic prose and the dedicated section's code example.
  const bytes = new Uint8Array([...new TextEncoder().encode("OTFI"), 1, 1, 0, 8, ...new TextEncoder().encode("usestate"), 1, 0,
    0, 2, ...varint(text.indexOf("useState") * 8 + 6), ...varint((match - text.indexOf("useState")) * 8 + 4)]);
  await withIndex({ chunks: [{ first: "usestate", file: "t/a.bin", bytes }], fragments: [{
    url: "/guide/?lang=en#old", text, anchors: [{ id: "overview", pos: 0 }, { id: "state hook", pos: heading }],
  }] }, async (search) => {
    const result = (await search.query("useState")).results[0];
    expect(result.url).toBe("/guide/?lang=en#state%20hook");
    expect(result.excerpt.includes("useState details")).toBe(true);
  });
});

test("uses posting offsets for folded Unicode and prefix section matches", async () => {
  const text = "Guide 😀 Café details";
  await withIndex({ chunks: [{ first: "cafe", file: "t/a.bin", bytes: termsChunk([["cafe", [[0, text.indexOf("Café")]]]]) }],
    fragments: [{ url: "/guide/", text, anchors: [{ id: "café", pos: text.indexOf("Café") }] }] }, async (search) => {
    expect((await search.query("caf")).results[0].url).toBe("/guide/#caf%C3%A9");
    expect((await search.query("cafe")).results[0].url).toBe("/guide/#caf%C3%A9");
  });
});

test("keeps the page URL for matches before the first section", async () => {
  await withIndex({ chunks: [{ first: "guide", file: "t/a.bin", bytes: termsChunk([["guide", [[0, 0]]]]) }],
    fragments: [{ url: "/guide/", text: "Guide Routing", anchors: [{ id: "routing", pos: 6 }] }] }, async (search) => {
    expect((await search.query("guide")).results[0].url).toBe("/guide/");
  });
});


test("previews prose without code dumps and reports the matching section", async () => {
  const code = '<div class="card">HTML example</div>';
  const text = `Styling Use class for styling. ${code} CSS Modules Files are scoped.`;
  const from = text.indexOf(code), to = from + code.length;
  await withIndex({ chunks: [{ first: "class", file: "t/a.bin", bytes: termsChunk([["class", [[0, text.indexOf("class")]]]]) }],
    fragments: [{ url: "/styling/", text, excerptOmit: [[from, to]], anchors: [{ id: "styling", text: "Styling", pos: 0 }] }] }, async (search) => {
    const result = (await search.query("class")).results[0];
    expect(result.section).toBe("Styling");
    expect(result.excerpt.includes('<div')).toBe(false);
    expect(result.excerpt.includes('Use class')).toBe(true);
    expect(result.highlights.map(([from, to]) => result.excerpt.slice(from, to))).toEqual(["class"]);
  });
});

test("highlight ranges preserve original accents, identifier spelling, and safe text", async () => {
  const text = "😀 Café useState <img onerror=evil()>";
  await withIndex({ chunks: [{ first: "cafe", file: "t/a.bin", bytes: termsChunk([["cafe", [[0, text.indexOf("Café")]]], ["usestate", [[0, text.indexOf("useState")]]]]) }],
    fragments: [{ url: "/guide/", text }] }, async (search) => {
    const result = (await search.query("cafe useSt")).results[0];
    const parts = excerptParts(result.excerpt, result.highlights);
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Café", "useState"]);
    expect(parts.map((part) => part.text).join('')).toBe(result.excerpt);
    expect(parts.some((part) => !part.match && part.text.includes('<img'))).toBe(true);
  });
});
