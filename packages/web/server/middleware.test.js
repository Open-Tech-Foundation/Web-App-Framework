import { describe, expect, test } from "bun:test";

import { createMiddleware, middlewareScopeFromPath } from "./middleware.js";

const req = (url, init) => new Request(`http://localhost${url}`, init);
// A terminal that echoes what it received — the pathname it routed on and the
// locals middleware stamped — so tests can assert on the pipeline's hand-off.
const echo = (r, context) => Response.json({ path: new URL(r.url).pathname, locals: context.locals });
const mw = (fn) => ({ default: fn });

describe("middlewareScopeFromPath", () => {
  test("derives the folder route a _middleware governs", () => {
    expect(middlewareScopeFromPath("/proj/app/api/_middleware.js")).toBe("/api");
    expect(middlewareScopeFromPath("/proj/app/_middleware.js")).toBe("/");
    expect(middlewareScopeFromPath("/proj/app/approvals/_middleware.js", "/proj/app")).toBe("/approvals");
  });
});

describe("createMiddleware — scope selection", () => {
  test("a root _middleware governs every request, page or API", async () => {
    const seen = [];
    const runner = createMiddleware({
      "/app/_middleware.js": mw((r, _c, next) => (seen.push(new URL(r.url).pathname), next())),
    });
    await runner.run(req("/"), echo);
    await runner.run(req("/admin/settings"), echo);
    await runner.run(req("/api/users/1"), echo);
    expect(seen).toEqual(["/", "/admin/settings", "/api/users/1"]);
  });

  test("a scoped _middleware only runs inside its folder", async () => {
    let hits = 0;
    const runner = createMiddleware({
      "/app/admin/_middleware.js": mw((_r, _c, next) => (hits++, next())),
    });
    await runner.run(req("/admin"), echo);
    await runner.run(req("/admin/users"), echo);
    await runner.run(req("/administrator"), echo); // sibling, not nested
    await runner.run(req("/about"), echo);
    expect(hits).toBe(2);
  });

  test("chains compose outermost-first and unwind innermost-first", async () => {
    const order = [];
    const runner = createMiddleware({
      "/app/api/users/_middleware.js": mw(async (_r, _c, next) => {
        order.push("inner:before");
        const res = await next();
        order.push("inner:after");
        return res;
      }),
      "/app/_middleware.js": mw(async (_r, _c, next) => {
        order.push("outer:before");
        const res = await next();
        order.push("outer:after");
        return res;
      }),
    });
    await runner.run(req("/api/users/1"), echo);
    expect(order).toEqual(["outer:before", "inner:before", "inner:after", "outer:after"]);
  });

  test("size and scopes report the discovered middleware (outermost first)", () => {
    const runner = createMiddleware({
      "/app/api/_middleware.js": mw((_r, _c, n) => n()),
      "/app/_middleware.js": mw((_r, _c, n) => n()),
    });
    expect(runner.size).toBe(2);
    expect(runner.scopes).toEqual(["/", "/api"]);
    expect(createMiddleware({}).size).toBe(0);
  });

  test("a module without a middleware function is inert", async () => {
    const runner = createMiddleware({ "/app/_middleware.js": { notAMiddleware: 1 } });
    expect(runner.size).toBe(0);
    const res = await runner.run(req("/x"), echo);
    expect((await res.json()).path).toBe("/x");
  });
});

describe("createMiddleware — data endpoint and i18n scoping", () => {
  test("a page's __data.json request is governed by the page's scope", async () => {
    const gate = createMiddleware({
      "/app/admin/_middleware.js": mw((r, _c, next) =>
        r.headers.get("cookie") ? next() : Response.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    });
    expect((await gate.run(req("/admin/__data.json"), echo)).status).toBe(401);
    expect((await gate.run(req("/admin/stats/__data.json"), echo)).status).toBe(401);
    const ok = await gate.run(req("/admin/__data.json", { headers: { cookie: "s=1" } }), echo);
    expect(ok.status).toBe(200);
    // the root data request maps to the "/" page (root scope only)
    expect((await gate.run(req("/__data.json"), echo)).status).toBe(200);
  });

  test("a non-default locale prefix is stripped before scope matching", async () => {
    let hits = 0;
    const runner = createMiddleware(
      { "/app/admin/_middleware.js": mw((_r, _c, next) => (hits++, next())) },
      { i18n: { locales: ["en", "fr"], defaultLocale: "en" } },
    );
    await runner.run(req("/fr/admin"), echo);
    await runner.run(req("/fr/admin/users"), echo);
    await runner.run(req("/admin"), echo);
    await runner.run(req("/fr"), echo); // "/" — outside /admin
    expect(hits).toBe(3);
  });
});

describe("createMiddleware — responses, locals, rewrites, errors", () => {
  test("returning a Response short-circuits (the terminal never runs)", async () => {
    let terminalRan = false;
    const runner = createMiddleware({
      "/app/_middleware.js": mw(() => Response.json({ error: "nope" }, { status: 403 })),
    });
    const res = await runner.run(req("/x"), () => ((terminalRan = true), echo(req("/x"), { locals: {} })));
    expect(res.status).toBe(403);
    expect(terminalRan).toBe(false);
  });

  test("a thrown Response is honored (guard convention, same as API handlers)", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw(() => {
        throw Response.redirect("http://localhost/login", 302);
      }),
    });
    const res = await runner.run(req("/private"), echo);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  test("locals stamped by middleware reach the terminal's context", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw((_r, context, next) => {
        context.locals.user = "ada";
        return next();
      }),
    });
    const res = await runner.run(req("/todos"), echo);
    expect((await res.json()).locals).toEqual({ user: "ada" });
  });

  test("next(rewrittenRequest) re-routes the terminal", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw((r, _c, next) => {
        const url = new URL(r.url);
        if (url.pathname === "/old") return next(new Request(new URL("/new", url), r));
        return next();
      }),
    });
    expect((await (await runner.run(req("/old"), echo)).json()).path).toBe("/new");
    expect((await (await runner.run(req("/other"), echo)).json()).path).toBe("/other");
  });

  test("middleware can wrap next() and modify the outgoing response", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw(async (_r, _c, next) => {
        const res = await next();
        const wrapped = new Response(res.body, res);
        wrapped.headers.set("x-frame-options", "DENY");
        return wrapped;
      }),
    });
    const res = await runner.run(req("/page"), echo);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect((await res.json()).path).toBe("/page");
  });

  test("a middleware throw is a 500 JSON envelope", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw(() => {
        throw new Error("boom");
      }),
    });
    const res = await runner.run(req("/x"), echo);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal Server Error");
  });

  test("returning nothing (forgotten `return next()`) is a 500, not a hang", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw((_r, _c, next) => {
        next(); // fired but not returned
      }),
    });
    const res = await runner.run(req("/x"), echo);
    expect(res.status).toBe(500);
  });

  test("env/ctx extras are exposed on the context", async () => {
    const runner = createMiddleware({
      "/app/_middleware.js": mw((_r, context, next) => {
        context.locals.env = context.env;
        return next();
      }),
    });
    const res = await runner.run(req("/x"), echo, { env: { KV: "binding" } });
    expect((await res.json()).locals.env).toEqual({ KV: "binding" });
  });
});
