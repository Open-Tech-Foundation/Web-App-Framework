// Root request middleware (docs/MIDDLEWARE.md): governs every request — pages,
// API endpoints, and loader-data URLs. Stamps `locals` (read back by loaders and
// handlers) and a response header (proves middleware wraps the outgoing Response).
export default async function (request, context, next) {
  context.locals.mwUser = "e2e";
  const res = await next();
  const wrapped = new Response(res.body, res);
  wrapped.headers.set("x-otfw-mw", "root");
  return wrapped;
}
