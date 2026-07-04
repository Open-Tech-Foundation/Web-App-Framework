// An API route. Any `route.js` / `route.ts` file is a server endpoint whose folder
// is the URL — this one answers GET /api/hello. Handlers take a standard Request and
// return a standard Response, so they run on Bun, Node, Cloudflare Workers, and Deno.
//
// Available under `bun run dev` and `bun run serve`. Export POST/PUT/etc. for more
// methods, add `[param]` folders for dynamic routes, and drop a `_middleware.js` in
// this folder for auth/validation. See https://web.opentechf.org/docs/routing/api-routes
export function GET() {
  return Response.json({
    message: "Hello from your API route 👋",
    time: new Date().toISOString(),
  });
}
