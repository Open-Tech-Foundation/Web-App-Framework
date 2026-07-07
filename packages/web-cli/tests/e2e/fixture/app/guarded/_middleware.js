// Folder middleware gating a *page* (and, via scope matching, its
// `/guarded/__data.json` loader endpoint): no auth cookie → redirect to /about.
export default function (request, context, next) {
  if (!/(?:^|;\s*)auth=1(?:;|$)/.test(request.headers.get("cookie") || "")) {
    return new Response(null, { status: 302, headers: { location: "/about" } });
  }
  return next();
}
