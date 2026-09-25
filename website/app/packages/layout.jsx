// Packages section layout — the @opentf/web runtime, macros, server, and CLI
// reference, split out of /api into its own menu. Same shell as the docs and
// API layouts: the marketing navbar/footer come from the root site layout
// (app/layout.jsx), so this renders with `frame={false}` — only the
// sidebar · content · TOC grid. DocsLayout sources the generated sidebar and
// scopes it to /packages by route.

import { DocsLayout } from "@opentf/web-docs";
import config from "../../otfw.config.js";

export default function PackagesLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} siteUrl={config.site?.url} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
