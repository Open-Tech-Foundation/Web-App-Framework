// Folder middleware gating a *page* (and, via scope matching, its
// `/guarded/__data.json` loader endpoint): no auth cookie → redirect to /about.
// Reads the cookie via the framework helper (proves it works through bundling).
import { getCookie } from "@opentf/web/server";

export default function (request, context, next) {
  if (getCookie(request, "auth") !== "1") {
    return new Response(null, { status: 302, headers: { location: "/about" } });
  }
  return next();
}
