/** Escape text content for HTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Escape an attribute value. */
export function escapeAttr(s) {
  return String(s).replace(/[&"]/g, (c) => (c === "&" ? "&amp;" : "&quot;"));
}

