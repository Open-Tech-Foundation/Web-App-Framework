import { expect, test } from "bun:test";
import { createSearch } from "../search.js";

function varint(value) { const out = []; while (value >= 128) { out.push((value & 127) | 128); value >>= 7; } return [...out, value]; }

test("queries a binary term chunk and expands the final prefix", async () => {
  // OTFI v1: one front-coded term, one posting (doc 0, tf 1, packed position 0).
  const chunk = new Uint8Array([...new TextEncoder().encode("OTFI"), 1, ...varint(1), 0, ...varint(7), ...new TextEncoder().encode("routing"), 1, 0, 0, 1, 0]);
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
  try {
    await expect(createSearch().query("routing", { signal: controller.signal })).rejects.toThrow("aborted");
  } finally { globalThis.fetch = original; }
});
