// Docs section layout. The marketing navbar/footer come from the root site layout
// (app/layout.jsx), so the docs shell renders with `frame={false}` — only the
// sidebar · content · TOC grid. DocsLayout sources the generated sidebar itself and
// scopes it to the current route, so this is the whole file.

import { DocsLayout } from "@opentf/web-docs";
import config from "../../otfw.config.js";

export default function DocsLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
