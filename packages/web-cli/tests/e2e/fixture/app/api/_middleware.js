// Folder middleware for /api/* (SPEC §11.5). Stamps a value into `locals` for
// downstream handlers, and gates a path to prove short-circuiting works.
export default function (request, context, next) {
  context.locals.stamp = "mw";
  const url = new URL(request.url);
  if (url.pathname === "/api/secret" && !request.headers.get("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return next();
}
