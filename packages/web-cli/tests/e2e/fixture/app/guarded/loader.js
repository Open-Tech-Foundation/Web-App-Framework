// Loader behind the /guarded middleware — its `__data.json` endpoint must be
// gated too (the SPA-navigation path must not leak what the page path guards).
export default function loader() {
  return { secret: "classified" };
}
