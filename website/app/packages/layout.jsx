// Packages section layout — only the optional packages live here now (core
// reference moved to /docs). Same shell as the docs and API layouts: the
// marketing navbar/footer come from the root site layout (app/layout.jsx),
// so this renders with `frame={false}` — only the sidebar · content · TOC
// grid.
//
// Sidebar shape: package groups render as toggle-only headers with an
// "Overview" first child (instead of a header that is also a link), so every
// sidebar row is either a toggle or a link, never both.

import { DocsLayout } from "@opentf/web-docs";
import navMap from "@opentf/web-docs/nav";
import config from "../../otfw.config.js";

// A group that is also a page becomes a toggle-only header with its page
// re-homed as an "Overview" child link. Active-branch detection and the
// collapse-all button key off paths in the subtree, so both keep working —
// the overview child carries the group page's path.
function withOverviewLinks(items) {
  return items.map((item) => {
    if (!item.items || item.items.length === 0) return item;
    const children = withOverviewLinks(item.items);
    if (!item.path) return { ...item, items: children };
    const { path, ...header } = item;
    return { ...header, items: [{ title: "Overview", path }, ...children] };
  });
}

const sectionNav = withOverviewLinks(navMap["/packages"] ?? []);

export default function PackagesLayoutRoute(props) {
  return (
    <DocsLayout config={config.docs} siteUrl={config.site?.url} frame={false} nav={sectionNav}>
      {props.children}
    </DocsLayout>
  );
}
