// A route loader (docs/DATA.md): plain server module, default export returns the
// page's JSON data. `query` proves the request reaches the loader under serve/dev;
// `locals` proves the root middleware's stamp reaches loaders (docs/MIDDLEWARE.md).
export default function loader({ query, locals }) {
  return { items: ["alpha", "beta"], q: query.q ?? null, mw: locals.mwUser ?? null };
}
