// A *page* under /api — proves pages and API handlers coexist in the same prefix.
// discoverApiRoutes skips page.jsx, and an /api/* handler miss falls through to SSR.
export default function ApiDocs() {
  return <h1>E2E_API_DOCS_PAGE</h1>;
}
