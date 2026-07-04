// Guarded by app/api/_middleware.js unless an Authorization header is present.
export function GET() {
  return Response.json({ secret: true });
}
