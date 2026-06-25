// API section layout — a standalone reference with its own sidebar, separate from the
// main docs. The marketing navbar/footer come from the root site layout
// (app/layout.jsx), so this renders with `frame={false}`. The sidebar nav tree is
// generated from app/api/**/_meta.js + MDX frontmatter (@opentf/web-docs/nav-api),
// independent of the docs tree.

import { DocsLayout } from "@opentf/web-docs";
import nav from "@opentf/web-docs/nav-api";
import config from "../../otfw.config.js";

export default function ApiLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} nav={nav} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
