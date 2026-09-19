import { expect, test } from "../../web-cli/tests/harness.js";
import { createSearch } from "../search.js";

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
