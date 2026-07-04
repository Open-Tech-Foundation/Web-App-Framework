// Static API route → GET /api/status. Plain server module (SPEC §11).
export function GET() {
  return Response.json({ ok: true, service: "e2e" });
}

export async function POST(request) {
  const body = await request.json();
  return Response.json({ received: body }, { status: 201 });
}
