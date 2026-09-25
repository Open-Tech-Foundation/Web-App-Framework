import { describe, expect, test } from "runtime:test";

import { createFetchHandler } from "../api.js";
import { sendWebResponse, toNodeListener, toWebRequest } from "./node.js";

// The adapter is Node-specific (`req.on`, `Buffer`), but its contract is
// stream-agnostic — so the fakes stay web-standard and a two-function `Buffer`
// shim covers what the adapter touches (`concat`/`from`). That keeps this suite
// on the shared esdev runner instead of a Node-only harness.
globalThis.Buffer ??= {
  concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  },
  from(data) {
    if (typeof data === "string") return new TextEncoder().encode(data);
    return new Uint8Array(data);
  },
};

// A minimal IncomingMessage: method/url/headers plus an `on()` emitter that
// delivers `body` as bytes, then ends — the only stream surface the adapter reads.
function fakeReq({ method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const listeners = {};
  const stream = {
    method,
    url,
    headers: { host: "localhost", ...headers },
    on(ev, fn) {
      (listeners[ev] ??= []).push(fn);
      return stream;
    },
  };
  queueMicrotask(() => {
    if (body) {
      const bytes = new TextEncoder().encode(body);
      for (const fn of listeners.data ?? []) fn(bytes);
    }
    for (const fn of listeners.end ?? []) fn();
  });
  return stream;
}

// A minimal ServerResponse capturing status/headers/body.
function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    headersSent: false,
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) this.body += new TextDecoder().decode(chunk);
    },
  };
}

describe("toWebRequest", () => {
  test("builds a Fetch Request with method, url, and headers", async () => {
    const req = await toWebRequest(fakeReq({ method: "GET", url: "/api/x?q=1", headers: { "x-test": "1" } }));
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/api/x");
    expect(req.headers.get("x-test")).toBe("1");
  });

  test("reads the request body for non-GET methods", async () => {
    const req = await toWebRequest(fakeReq({ method: "POST", url: "/api/x", body: '{"a":1}' }));
    expect(await req.json()).toEqual({ a: 1 });
  });
});

describe("sendWebResponse", () => {
  test("writes status, headers, and body to the Node response", async () => {
    const res = fakeRes();
    await sendWebResponse(res, Response.json({ ok: true }, { status: 201 }));
    expect(res.statusCode).toBe(201);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  test("multiple Set-Cookie headers stay separate (array header value)", async () => {
    const res = fakeRes();
    const webRes = new Response(null, { status: 200 });
    webRes.headers.append("set-cookie", "session=abc; Path=/; HttpOnly");
    webRes.headers.append("set-cookie", "csrf=xyz; Path=/");
    await sendWebResponse(res, webRes);
    expect(res.headers["set-cookie"]).toEqual(["session=abc; Path=/; HttpOnly", "csrf=xyz; Path=/"]);
  });
});

describe("toNodeListener", () => {
  test("routes a matched request through the handler", async () => {
    const listener = toNodeListener(async () => Response.json({ hit: true }));
    const res = fakeRes();
    await listener(fakeReq({ url: "/api/thing" }), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hit: true });
  });

  test("a null result becomes a 404 (or the fallback)", async () => {
    const res404 = fakeRes();
    await toNodeListener(async () => null)(fakeReq(), res404);
    expect(res404.statusCode).toBe(404);

    const resFb = fakeRes();
    await toNodeListener(async () => null, { fallback: () => new Response("shell", { status: 200 }) })(fakeReq(), resFb);
    expect(resFb.statusCode).toBe(200);
    expect(resFb.body).toBe("shell");
  });
});

describe("createFetchHandler", () => {
  test("turns a null-returning handler into a total Fetch handler", async () => {
    const fetch404 = createFetchHandler(async () => null);
    expect((await fetch404(new Request("http://x/api/none"))).status).toBe(404);

    const fetchHit = createFetchHandler(async () => Response.json("ok"));
    expect(await (await fetchHit(new Request("http://x/api/x"))).json()).toBe("ok");
  });
});
