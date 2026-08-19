import { serve } from "runtime:http";

import { describe, expect, test } from "./harness.js";

import { matchProxyTarget, proxyRequest, resolveProxyRules } from "../src/shared.js";

describe("resolveProxyRules", () => {
  test("no proxy config → no rules", () => {
    expect(resolveProxyRules({})).toEqual([]);
    expect(resolveProxyRules(undefined)).toEqual([]);
    expect(resolveProxyRules({ proxy: null })).toEqual([]);
  });

  test("string target: normalizes trailing slashes on prefix and target", () => {
    expect(resolveProxyRules({ proxy: { "/api/": "http://localhost:8787/" } })).toEqual([
      { prefix: "/api", target: "http://localhost:8787" },
    ]);
  });

  test("object { target } form is accepted; entries without a target are dropped", () => {
    expect(resolveProxyRules({ proxy: { "/api": { target: "http://localhost:8787" }, "/x": {} } })).toEqual([
      { prefix: "/api", target: "http://localhost:8787" },
    ]);
  });

  test("rules are sorted longest-prefix-first", () => {
    const rules = resolveProxyRules({
      proxy: { "/api": "http://a", "/api/admin": "http://b", "/": "http://c" },
    });
    expect(rules.map((r) => r.prefix)).toEqual(["/api/admin", "/api", "/"]);
  });
});

describe("matchProxyTarget", () => {
  const rules = resolveProxyRules({ proxy: { "/api/admin": "http://admin", "/api": "http://api" } });

  test("matches the exact prefix and nested paths", () => {
    expect(matchProxyTarget("/api", rules)).toBe("http://api");
    expect(matchProxyTarget("/api/todos", rules)).toBe("http://api");
  });

  test("the most specific (longest) prefix wins", () => {
    expect(matchProxyTarget("/api/admin/users", rules)).toBe("http://admin");
  });

  test("a partial segment match is not a match (/apiX ≠ /api)", () => {
    expect(matchProxyTarget("/apiX", rules)).toBeNull();
    expect(matchProxyTarget("/other", rules)).toBeNull();
  });

  test('a "/" prefix catches everything', () => {
    const all = resolveProxyRules({ proxy: { "/": "http://up" } });
    expect(matchProxyTarget("/anything/here", all)).toBe("http://up");
  });
});

describe("proxyRequest", () => {
  // A one-response upstream on an ephemeral port. `serve` returns before it binds, so
  // the port is only known once `addr` resolves.
  async function upstream(response) {
    const server = serve({ port: 0 }, () => response());
    const { port } = await server.addr;
    return { port, stop: () => server.stop() };
  }

  const gzip = async (text) =>
    new Uint8Array(
      await new Response(
        new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );

  test("gzipped upstream: encoding headers are stripped so the body is not double-decoded", async () => {
    const payload = JSON.stringify({ todos: ["a", "b"] });
    const body = await gzip(payload);
    const { port, stop } = await upstream(
      () =>
        new Response(body, {
          headers: { "content-type": "application/json", "content-encoding": "gzip" },
        }),
    );
    try {
      const req = new Request("http://localhost:3000/api/todos", {
        headers: { "accept-encoding": "gzip, deflate, br" },
      });
      const res = await proxyRequest(req, `http://localhost:${port}`);
      // fetch already decompressed the body; the relayed response must not
      // claim gzip (or the compressed length) or the browser decodes twice.
      expect(res.headers.get("content-encoding")).toBeNull();
      expect(res.headers.get("content-length")).toBeNull();
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.text()).toBe(payload);
    } finally {
      await stop();
    }
  });

  test("uncompressed upstream: the response passes through untouched", async () => {
    const { port, stop } = await upstream(
      () => new Response("plain", { headers: { "content-type": "text/plain" } }),
    );
    try {
      const res = await proxyRequest(new Request("http://localhost:3000/api/x"), `http://localhost:${port}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("plain");
    } finally {
      await stop();
    }
  });
});
