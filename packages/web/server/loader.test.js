import { describe, expect, test } from "bun:test";

import {
  createLoaderRegistry,
  isNotFound,
  loaderRouteFromPath,
  notFound,
  serializeRouteData,
} from "./loader.js";

const mod = (fn) => ({ default: fn });

describe("loaderRouteFromPath", () => {
  test("folder = URL; root loader maps to /", () => {
    expect(loaderRouteFromPath("/proj/app/todos/loader.js", "/proj/app")).toBe("/todos");
    expect(loaderRouteFromPath("/proj/app/items/[id]/loader.ts", "/proj/app")).toBe("/items/[id]");
    expect(loaderRouteFromPath("/proj/app/loader.js", "/proj/app")).toBe("/");
  });

  test("without appDir, falls back to the last complete /app segment", () => {
    expect(loaderRouteFromPath("/x/app/docs/loader.js")).toBe("/docs");
    // a folder merely starting with "app" is not clipped
    expect(loaderRouteFromPath("/x/app/appointments/loader.js")).toBe("/appointments");
  });
});

describe("registry matching", () => {
  const registry = createLoaderRegistry(
    {
      "/proj/app/todos/loader.js": mod(() => ({ kind: "todos" })),
      "/proj/app/items/[id]/loader.js": mod(({ params }) => ({ id: params.id })),
      "/proj/app/docs/[...slug]/loader.js": mod(({ params }) => ({ slug: params.slug })),
    },
    { appDir: "/proj/app" },
  );

  test("static route", () => {
    const m = registry.match("/todos");
    expect(m.route).toBe("/todos");
    expect(m.params).toEqual({});
  });

  test("tolerates a trailing slash", () => {
    expect(registry.match("/todos/")?.route).toBe("/todos");
  });

  test("[param] resolves percent-decoded", () => {
    const m = registry.match("/items/John%20Doe");
    expect(m.route).toBe("/items/[id]");
    expect(m.params.id).toBe("John Doe");
  });

  test("[...rest] splits into decoded segments", () => {
    const m = registry.match("/docs/a/b%20c");
    expect(m.params.slug).toEqual(["a", "b c"]);
  });

  test("no loader → null", () => {
    expect(registry.match("/nope")).toBe(null);
  });

  test("routes lists the registered patterns", () => {
    expect([...registry.routes].sort()).toEqual(["/docs/[...slug]", "/items/[id]", "/todos"]);
  });

  test("a module without a loader function is inert", () => {
    const r = createLoaderRegistry({ "/proj/app/x/loader.js": { notALoader: 1 } }, { appDir: "/proj/app" });
    expect(r.match("/x")).toBe(null);
  });

  test("named `loader` export is accepted (Phase B convention)", async () => {
    const r = createLoaderRegistry(
      { "/proj/app/x/loader.js": { loader: () => "named" } },
      { appDir: "/proj/app" },
    );
    expect(await r.load(r.match("/x"))).toBe("named");
  });
});

describe("i18n locale prefix", () => {
  const registry = createLoaderRegistry(
    { "/proj/app/todos/loader.js": mod(({ locale }) => ({ locale })) },
    { appDir: "/proj/app", i18n: { locales: ["en", "fr"], defaultLocale: "en" } },
  );

  test("a non-default prefix is stripped and recorded", async () => {
    const m = registry.match("/fr/todos");
    expect(m.route).toBe("/todos");
    expect(m.locale).toBe("fr");
    expect(await registry.load(m)).toEqual({ locale: "fr" });
  });

  test("the bare path carries the default locale", () => {
    expect(registry.match("/todos").locale).toBe("en");
  });
});

describe("load context", () => {
  test("params, query, request, locale, locals all reach the loader", async () => {
    let seen;
    const registry = createLoaderRegistry(
      { "/proj/app/items/[id]/loader.js": mod((ctx) => (seen = ctx) && ctx.params.id) },
      { appDir: "/proj/app" },
    );
    const request = new Request("http://x/items/7/__data.json");
    const result = await registry.load(registry.match("/items/7"), { request, query: { q: "1" } });
    expect(result).toBe("7");
    expect(seen.params).toEqual({ id: "7" });
    expect(seen.query).toEqual({ q: "1" });
    expect(seen.request).toBe(request);
    expect(seen.locale).toBe(null);
    expect(seen.locals).toEqual({});
  });

  test("request is undefined when the caller has none (SSG prerender)", async () => {
    let seen;
    const registry = createLoaderRegistry(
      { "/proj/app/todos/loader.js": mod((ctx) => (seen = ctx) && null) },
      { appDir: "/proj/app" },
    );
    await registry.load(registry.match("/todos"));
    expect(seen.request).toBe(undefined);
    expect(seen.query).toEqual({});
  });

  test("loadSerialized returns the data and its escaped JSON", async () => {
    const registry = createLoaderRegistry(
      { "/proj/app/todos/loader.js": mod(() => ({ html: "</script>" })) },
      { appDir: "/proj/app" },
    );
    const { data, json } = await registry.loadSerialized(registry.match("/todos"));
    expect(data).toEqual({ html: "</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ html: "</script>" });
  });
});

describe("handle — the __data.json endpoint", () => {
  const registry = createLoaderRegistry(
    {
      "/proj/app/todos/loader.js": mod(({ query }) => ({ items: ["alpha"], q: query.q ?? null })),
      "/proj/app/items/[id]/loader.js": mod(({ params }) => {
        if (params.id === "missing") notFound();
        return { id: params.id };
      }),
      "/proj/app/boom/loader.js": mod(() => {
        throw new Error("BOOM");
      }),
    },
    { appDir: "/proj/app" },
  );

  test("a non-data path is not ours (null → caller falls through)", async () => {
    expect(await registry.handle(new Request("http://x/todos"))).toBe(null);
  });

  test("GET returns the raw loader JSON with json/no-store headers", async () => {
    const res = await registry.handle(new Request("http://x/todos/__data.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ items: ["alpha"], q: null });
  });

  test("the query string reaches the loader", async () => {
    const res = await registry.handle(new Request("http://x/todos/__data.json?q=abc"));
    expect((await res.json()).q).toBe("abc");
  });

  test("HEAD carries status/headers with no body", async () => {
    const res = await registry.handle(new Request("http://x/todos/__data.json", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("dynamic params resolve on the endpoint too", async () => {
    const res = await registry.handle(new Request("http://x/items/7/__data.json"));
    expect(await res.json()).toEqual({ id: "7" });
  });

  test("a data URL with no loader is a 404 (reserved — never falls through)", async () => {
    const res = await registry.handle(new Request("http://x/nope/__data.json"));
    expect(res.status).toBe(404);
  });

  test("notFound() from the loader is a 404", async () => {
    const res = await registry.handle(new Request("http://x/items/missing/__data.json"));
    expect(res.status).toBe(404);
  });

  test("a throwing loader is a 500 JSON error", async () => {
    const res = await registry.handle(new Request("http://x/boom/__data.json"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal Server Error");
  });

  test("non-GET/HEAD methods are 405 with Allow", async () => {
    const res = await registry.handle(new Request("http://x/todos/__data.json", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  test("root data URL maps to the root loader", async () => {
    const r = createLoaderRegistry({ "/proj/app/loader.js": mod(() => "root") }, { appDir: "/proj/app" });
    const res = await r.handle(new Request("http://x/__data.json"));
    expect(await res.json()).toBe("root");
  });
});

describe("serialization + notFound", () => {
  test("serializeRouteData escapes < so the payload can't close a script", () => {
    expect(serializeRouteData({ s: "</script><b>" })).toBe('{"s":"\\u003c/script>\\u003cb>"}');
  });

  test("undefined serializes to the empty string (no payload)", () => {
    expect(serializeRouteData(undefined)).toBe("");
  });

  test("isNotFound is a property check, not instanceof (cross-bundle safe)", () => {
    let caught;
    try {
      notFound("gone");
    } catch (e) {
      caught = e;
    }
    expect(isNotFound(caught)).toBe(true);
    expect(caught.message).toBe("gone");
    // an error re-created across a bundle boundary still qualifies
    expect(isNotFound({ otfwNotFound: true })).toBe(true);
    expect(isNotFound(new Error("x"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
