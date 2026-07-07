import { describe, expect, test } from "bun:test";

import { apiRouteFromPath, createApiHandler, createFetchHandler, middlewareScopeFromPath } from "./api.js";
import { createMiddleware } from "./middleware.js";

const req = (url, init) => new Request(`http://localhost${url}`, init);

describe("apiRouteFromPath", () => {
  test("maps route.* file paths to routes (folder = URL)", () => {
    expect(apiRouteFromPath("/proj/app/api/status/route.js")).toBe("/api/status");
    expect(apiRouteFromPath("/proj/app/api/users/[id]/route.ts")).toBe("/api/users/[id]");
    expect(apiRouteFromPath("/proj/app/api/files/[...path]/route.js")).toBe("/api/files/[...path]");
    expect(apiRouteFromPath("/proj/app/api/route.js")).toBe("/api");
    expect(apiRouteFromPath("/proj/app/route.js")).toBe("/");
  });

  test("folders that merely start with 'app' are not clipped", () => {
    expect(apiRouteFromPath("/proj/app/api/appointments/route.js")).toBe("/api/appointments");
    expect(apiRouteFromPath("/proj/app/apps/[id]/route.ts")).toBe("/apps/[id]");
  });

  test("an explicit appDir strips the exact prefix (handles app/app nesting)", () => {
    expect(apiRouteFromPath("/proj/app/app/status/route.js", "/proj/app")).toBe("/app/status");
    expect(apiRouteFromPath("/proj/app/api/status/route.js", "/proj/app")).toBe("/api/status");
  });
});

describe("middlewareScopeFromPath", () => {
  test("derives the folder route a _middleware governs", () => {
    expect(middlewareScopeFromPath("/proj/app/api/_middleware.js")).toBe("/api");
    expect(middlewareScopeFromPath("/proj/app/api/users/_middleware.ts")).toBe("/api/users");
    expect(middlewareScopeFromPath("/proj/app/_middleware.js")).toBe("/");
    expect(middlewareScopeFromPath("/proj/app/approvals/_middleware.js", "/proj/app")).toBe("/approvals");
  });
});

describe("createApiHandler", () => {
  test("returns null when no route matches (falls through to SSR)", async () => {
    const handle = createApiHandler({ "/app/api/status/route.js": { GET: () => Response.json({ ok: true }) } });
    expect(await handle(req("/not-api"))).toBeNull();
    expect(await handle(req("/api/missing"))).toBeNull();
  });

  test("dispatches static routes to the method handler", async () => {
    const handle = createApiHandler({
      "/app/api/status/route.js": { GET: () => Response.json({ ok: true }) },
    });
    const res = await handle(req("/api/status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("resolves dynamic [param] and passes params via context", async () => {
    const handle = createApiHandler({
      "/app/api/users/[id]/route.js": { GET: (_r, { params }) => Response.json({ id: params.id }) },
    });
    expect(await (await handle(req("/api/users/42"))).json()).toEqual({ id: "42" });
  });

  test("params arrive percent-decoded (catch-all segments too)", async () => {
    const handle = createApiHandler({
      "/app/api/users/[id]/route.js": { GET: (_r, { params }) => Response.json(params.id) },
      "/app/api/files/[...path]/route.js": { GET: (_r, { params }) => Response.json(params.path) },
    });
    expect(await (await handle(req("/api/users/John%20Doe"))).json()).toBe("John Doe");
    expect(await (await handle(req("/api/files/a%20b/c"))).json()).toEqual(["a b", "c"]);
  });

  test("literal dots in a route folder are matched literally, not as regex wildcards", async () => {
    const handle = createApiHandler({
      "/app/api/v1.0/route.js": { GET: () => Response.json("versioned") },
    });
    expect(await (await handle(req("/api/v1.0"))).json()).toBe("versioned");
    expect(await handle(req("/api/v1X0"))).toBeNull();
  });

  test("resolves [...rest] to an array segment", async () => {
    const handle = createApiHandler({
      "/app/api/files/[...path]/route.js": { GET: (_r, { params }) => Response.json({ path: params.path }) },
    });
    expect(await (await handle(req("/api/files/a/b/c"))).json()).toEqual({ path: ["a", "b", "c"] });
  });

  test("static routes take precedence over dynamic ones", async () => {
    const handle = createApiHandler({
      "/app/api/users/[id]/route.js": { GET: () => Response.json("dynamic") },
      "/app/api/users/me/route.js": { GET: () => Response.json("static") },
    });
    expect(await (await handle(req("/api/users/me"))).json()).toBe("static");
    expect(await (await handle(req("/api/users/9"))).json()).toBe("dynamic");
  });

  test("reads query params and body from the standard Request", async () => {
    const handle = createApiHandler({
      "/app/api/echo/route.js": {
        GET: (_r, { query }) => Response.json({ q: query.q }),
        POST: async (r) => Response.json(await r.json(), { status: 201 }),
      },
    });
    expect(await (await handle(req("/api/echo?q=hi"))).json()).toEqual({ q: "hi" });
    const post = await handle(req("/api/echo", { method: "POST", body: JSON.stringify({ a: 1 }) }));
    expect(post.status).toBe(201);
    expect(await post.json()).toEqual({ a: 1 });
  });

  test("405 with Allow header when the method is not exported", async () => {
    const handle = createApiHandler({ "/app/api/only-get/route.js": { GET: () => Response.json(1) } });
    const res = await handle(req("/api/only-get", { method: "DELETE" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toContain("GET");
  });

  test("auto HEAD from GET (no body) and auto OPTIONS", async () => {
    const handle = createApiHandler({ "/app/api/thing/route.js": { GET: () => Response.json({ a: 1 }) } });
    const head = await handle(req("/api/thing", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const opts = await handle(req("/api/thing", { method: "OPTIONS" }));
    expect(opts.status).toBe(204);
    expect(opts.headers.get("Allow")).toContain("GET");
  });

  test("auto HEAD from a lenient (plain-value) GET carries the JSON headers", async () => {
    const handle = createApiHandler({ "/app/api/plain/route.js": { GET: () => ({ a: 1 }) } });
    const head = await handle(req("/api/plain", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("application/json");
    expect(await head.text()).toBe("");
  });

  test("errors thrown in a handler become a 500 JSON response", async () => {
    const handle = createApiHandler({
      "/app/api/boom/route.js": {
        GET: () => {
          throw new Error("kaboom");
        },
      },
    });
    const res = await handle(req("/api/boom"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  test("a handler may throw a Response to short-circuit", async () => {
    const handle = createApiHandler({
      "/app/api/guarded/route.js": {
        GET: () => {
          throw Response.json({ error: "nope" }, { status: 403 });
        },
      },
    });
    const res = await handle(req("/api/guarded"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  test("middleware wraps handlers and can short-circuit", async () => {
    const routes = { "/app/api/private/route.js": { GET: () => Response.json("secret") } };
    const mw = {
      "/app/api/_middleware.js": {
        default: (r, _ctx, next) =>
          r.headers.get("authorization") ? next() : Response.json({ error: "Unauthorized" }, { status: 401 }),
      },
    };
    const handle = createApiHandler(routes, mw);
    expect((await handle(req("/api/private"))).status).toBe(401);
    const ok = await handle(req("/api/private", { headers: { authorization: "t" } }));
    expect(await ok.json()).toBe("secret");
  });

  test("middleware passes data to handlers via context.locals, nested outermost-first", async () => {
    const order = [];
    const routes = {
      "/app/api/users/[id]/route.js": { GET: (_r, { locals }) => Response.json(locals) },
    };
    const mw = {
      "/app/api/_middleware.js": {
        default: (_r, ctx, next) => {
          order.push("outer");
          ctx.locals.a = 1;
          return next();
        },
      },
      "/app/api/users/_middleware.js": {
        default: (_r, ctx, next) => {
          order.push("inner");
          ctx.locals.b = 2;
          return next();
        },
      },
    };
    const handle = createApiHandler(routes, mw);
    const res = await handle(req("/api/users/7"));
    expect(await res.json()).toEqual({ a: 1, b: 2 });
    expect(order).toEqual(["outer", "inner"]);
  });

  test("a root app/_middleware.* governs every route", async () => {
    const routes = { "/app/api/x/route.js": { GET: (_r, { locals }) => Response.json(locals) } };
    const mw = {
      "/app/_middleware.js": {
        default: (_r, ctx, next) => {
          ctx.locals.root = true;
          return next();
        },
      },
    };
    const handle = createApiHandler(routes, mw);
    expect(await (await handle(req("/api/x"))).json()).toEqual({ root: true });
  });

  test("init.locals shares a pipeline-middleware locals bag with the handlers", async () => {
    const handle = createApiHandler({
      "/app/api/me/route.js": { GET: (_r, { locals }) => Response.json(locals) },
    });
    const locals = { user: "ada" }; // stamped upstream by pipeline middleware
    const res = await handle(req("/api/me"), undefined, undefined, { locals });
    expect(await res.json()).toEqual({ user: "ada" });
  });

  test("middleware next(rewrittenRequest) hands the handler the replacement Request", async () => {
    const handle = createApiHandler(
      { "/app/api/echo/route.js": { GET: (r) => Response.json(r.headers.get("x-added")) } },
      {
        "/app/api/_middleware.js": {
          default: (r, _ctx, next) => {
            const withHeader = new Request(r, { headers: { "x-added": "yes" } });
            return next(withHeader);
          },
        },
      },
    );
    expect(await (await handle(req("/api/echo"))).json()).toBe("yes");
  });

  test("appDir option pins route derivation for app-prefixed folders", async () => {
    const handle = createApiHandler(
      { "/proj/app/api/appointments/route.js": { GET: () => Response.json("booked") } },
      {},
      { appDir: "/proj/app" },
    );
    expect(await (await handle(req("/api/appointments"))).json()).toBe("booked");
  });

  test("a non-Response return value is JSON-encoded", async () => {
    const handle = createApiHandler({ "/app/api/plain/route.js": { GET: () => ({ hello: "world" }) } });
    const res = await handle(req("/api/plain"));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  test("threads the runtime env/ctx (Workers bindings) into context", async () => {
    const handle = createApiHandler({
      "/app/api/todos/route.js": {
        GET: async (_r, { env, ctx }) => {
          const rows = await env.DB.query();
          ctx.waitUntil(Promise.resolve());
          return Response.json(rows);
        },
      },
    });
    const env = { DB: { query: () => Promise.resolve([{ id: 1 }]) } };
    const ctx = { waitUntil() {} };
    const res = await handle(req("/api/todos"), env, ctx);
    expect(await res.json()).toEqual([{ id: 1 }]);
  });
});

describe("createFetchHandler", () => {
  test("returns the handler Response when a route matches", async () => {
    const handle = createApiHandler({ "/app/api/status/route.js": { GET: () => Response.json({ ok: true }) } });
    const fetch = createFetchHandler(handle);
    expect(await (await fetch(req("/api/status"))).json()).toEqual({ ok: true });
  });

  test("a miss falls through to the fallback, forwarding env (env.ASSETS)", async () => {
    const handle = createApiHandler({ "/app/api/status/route.js": { GET: () => Response.json({ ok: true }) } });
    const env = { ASSETS: { fetch: () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) } };
    const fetch = createFetchHandler(handle, { fallback: (r, e) => e.ASSETS.fetch(r) });
    const res = await fetch(req("/some/spa/route"), env);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<!doctype html>");
  });

  test("a miss with no fallback is a 404", async () => {
    const handle = createApiHandler({});
    const fetch = createFetchHandler(handle);
    expect((await fetch(req("/anything"))).status).toBe(404);
  });

  test("a middleware runner wraps API dispatch and the fallback alike", async () => {
    const routes = createApiHandler({
      "/app/api/me/route.js": { GET: (_r, { locals }) => Response.json(locals) },
    });
    const middleware = createMiddleware({
      "/app/_middleware.js": {
        default: (r, ctx, next) => {
          if (!r.headers.get("cookie")) return new Response(null, { status: 401 });
          ctx.locals.user = "ada";
          return next();
        },
      },
    });
    const fetch = createFetchHandler(routes, { middleware, fallback: () => new Response("shell") });
    // gates the API route and the page fallback alike
    expect((await fetch(req("/api/me"))).status).toBe(401);
    expect((await fetch(req("/dashboard"))).status).toBe(401);
    // authorized: locals stamped by middleware reach the API handler; pages pass
    const authed = { headers: { cookie: "s=1" } };
    expect(await (await fetch(req("/api/me", authed))).json()).toEqual({ user: "ada" });
    expect(await (await fetch(req("/dashboard", authed))).text()).toBe("shell");
  });
});
