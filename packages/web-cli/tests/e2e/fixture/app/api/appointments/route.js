// Regression guard: a folder whose name starts with "app" must not be clipped by
// the app-dir prefix stripping (route must be /api/appointments, not "ointments").
export function GET() {
  return Response.json({ booked: true });
}
