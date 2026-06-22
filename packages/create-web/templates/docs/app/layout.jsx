// Root layout: wrap every page in the documentation shell (navbar + sidebar + TOC +
// footer). The sidebar nav is generated at build time from `_meta.js` + frontmatter.

import { DocsLayout } from "@opentf/web-docs";
import nav from "@opentf/web-docs/nav";
import config from "../otfw.config.js";

export default function Layout(props) {
  return (
    <DocsLayout config={config.docs} nav={nav}>
      {props.children}
    </DocsLayout>
  );
}
