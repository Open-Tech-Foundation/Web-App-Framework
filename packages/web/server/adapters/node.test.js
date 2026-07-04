import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";

import { createFetchHandler } from "../api.js";
import { sendWebResponse, toNodeListener, toWebRequest } from "./node.js";

// A minimal IncomingMessage: a readable stream carrying `body` plus method/url/headers.
function fakeReq({ method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = { host: "localhost", ...headers };
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
      if (chunk) this.body += chunk.toString();
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
