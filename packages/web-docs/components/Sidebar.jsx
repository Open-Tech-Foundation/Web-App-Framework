// Documentation sidebar — renders the build-time nav tree (from
// `@opentf/web-docs/nav`). Static content (crawlable with JS off); the active link
// updates reactively in SidebarNode.

import SidebarNode from "./SidebarNode.jsx";

export default function Sidebar(props) {
  const nav = props.nav || [];

  return (
    <aside class="otfw-sidebar">
      <nav class="otfw-sidebar-nav" aria-label="Documentation">
        <ul class="otfw-sidebar-list">
          {nav.map((item) => (
            <SidebarNode item={item} />
          ))}
        </ul>
      </nav>
    </aside>
  );
}
