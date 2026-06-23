// One node of the sidebar tree — a link, a group title, or both. Recurses into
// `item.items`. The active link is derived from `router.pathname` (reactive).

import { Link, router } from "@opentf/web";

export default function SidebarNode(props) {
  const item = props.item || {};
  const hasChildren = item.items && item.items.length > 0;

  return (
    <li class="otfw-sidebar-node">
      {item.path ? (
        <Link
          href={item.path}
          class={router.pathname === item.path ? "otfw-sidebar-link otfw-active" : "otfw-sidebar-link"}
        >
          <span class="otfw-sidebar-dot" aria-hidden="true"></span>
          {item.title}
        </Link>
      ) : (
        <span class="otfw-sidebar-group-title">{item.title}</span>
      )}
      {hasChildren ? (
        <ul class="otfw-sidebar-sublist">
          {item.items.map((child) => (
            <SidebarNode item={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
