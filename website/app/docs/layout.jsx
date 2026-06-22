// Docs section layout. The marketing navbar/footer come from the root site layout
// (app/layout.jsx), so the docs shell renders with `frame={false}` — only the
// sidebar · content · TOC grid. The sidebar nav tree is generated at build time from
// the app/docs/**/_meta.js files + MDX frontmatter (@opentf/web-docs/nav).

import { DocsLayout } from "@opentf/web-docs";
import nav from "@opentf/web-docs/nav";
import config from "../../otfw.config.js";

export default function DocsLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} nav={nav} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
