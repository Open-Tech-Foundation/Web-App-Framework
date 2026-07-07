import { describe, expect, test } from "bun:test";

import { matchProxyTarget, resolveProxyRules } from "../src/shared.js";

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
