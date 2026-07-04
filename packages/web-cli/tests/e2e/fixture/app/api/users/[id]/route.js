// Dynamic API route → GET /api/users/:id. Params arrive via the context arg.
export function GET(_request, { params, locals }) {
  return Response.json({ id: params.id, viaMiddleware: locals.stamp ?? null });
}
