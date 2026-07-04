// Node.js adapter for OTF Web API routes (SPEC §11.4). The API handler speaks the
// standard Fetch `Request`/`Response`; Bun, Cloudflare Workers, and Deno provide
// those natively, but `node:http` speaks its own `IncomingMessage`/`ServerResponse`.
// This adapter translates between the two so `dist/server/api.js` runs on Node.
//
//   import { createServer } from "node:http";
//   import { apiHandler } from "./dist/server/api.js";
//   import { toNodeListener } from "@opentf/web/server/adapters/node";
//   createServer(toNodeListener(apiHandler)).listen(3000);

/** Build a WHATWG `Request` from a Node `IncomingMessage`. */
export async function toWebRequest(req, { protocol = "http" } = {}) {
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${req.url}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v != null) headers.set(k, v);
  }
  // GET/HEAD must not carry a body; everything else streams the request in.
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Write a WHATWG `Response` to a Node `ServerResponse`. */
export async function sendWebResponse(res, webRes) {
  const headers = {};
  webRes.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  // `Headers` iteration collapses repeated Set-Cookie values into one string, which
  // breaks multi-cookie responses (session + CSRF). Recover the individual cookies;
  // Node accepts an array header value and writes one Set-Cookie line per entry.
  const cookies = webRes.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(webRes.status, headers);
  if (webRes.body) {
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
}

/**
 * Turn a Fetch handler `(request) => Response | null` into a Node
 * `(req, res)` listener. A `null` result (no API route matched) becomes the
 * optional `fallback(request)` response, or a 404.
 */
export function toNodeListener(handler, { fallback } = {}) {
  return async (req, res) => {
    try {
      const request = await toWebRequest(req);
      let webRes = await handler(request);
      if (!webRes) webRes = fallback ? await fallback(request) : new Response("Not Found", { status: 404 });
      await sendWebResponse(res, webRes);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
      console.error("✗ API (node adapter):", e?.stack ?? e);
    }
  };
}
