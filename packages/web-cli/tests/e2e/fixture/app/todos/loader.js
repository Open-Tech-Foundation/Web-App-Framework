// A route loader (docs/DATA.md): plain server module, default export returns the
// page's JSON data. `query` proves the request reaches the loader under serve/dev.
export default function loader({ query }) {
  return { items: ["alpha", "beta"], q: query.q ?? null };
}
