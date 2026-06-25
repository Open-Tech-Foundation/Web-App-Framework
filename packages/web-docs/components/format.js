// Small shared formatting helpers for the docs/blog components.

// `2026-06-24` (or any Date-parseable value) → `June 24, 2026`. Falls back to the raw
// string for anything the Date constructor can't parse, so a non-ISO value still
// renders.
export function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
