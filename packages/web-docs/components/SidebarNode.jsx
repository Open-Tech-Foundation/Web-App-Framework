// One node of the sidebar tree — a link, a collapsible group, or both. Recurses into
// `item.items`. Groups with children get a chevron toggle; the branch containing the
// active route stays open, and top-level groups start expanded. Open/closed state is
// per-session only (no persistence) — a reload resets to this derived default.
//
// The sidebar's "collapse all" button drives every node at once through the shared
// `collapseAll` signal (components/sidebar-collapse.js).

import { Link, router } from "@opentf/web";

import { collapseAll } from "./sidebar-collapse.js";

// True when `path` is `node` itself or lives somewhere in its subtree.
function treeContainsPath(node, path) {
  if (!node) return false;
  if (node.path === path) return true;
  if (!node.items || !node.items.length) return false;
  return node.items.some((child) => treeContainsPath(child, path));
}

export default function SidebarNode(props) {
  const item = props.item || {};
  const depth = props.depth || 0;
  // Deterministic position path ("0", "0-2", "0-2-1") — unique and identical on
  // server/client, so the aria-controls id is collision-free and hydration-safe.
  const nodeId = props.nodeId || "0";
  const hasChildren = item.items && item.items.length > 0;
  const panelId = `otfw-nav-${nodeId}`;

  const containsActive = () => treeContainsPath(item, router.pathname);
  let expanded = $state(hasChildren && (containsActive() || depth === 0));

  // Re-open the branch that holds the active route whenever navigation enters it.
  $effect(() => {
    if (hasChildren && containsActive()) expanded = true;
  });

  // Follow the sidebar's "collapse all" / "expand all" button. A press collapses *every*
  // group, the active branch included — otherwise, reading a page inside the only open
  // branch, the press would visibly change nothing. Navigation under a standing
  // collapse-all is the other case: there the branch holding the new route opens, exactly
  // as it does without the button. Deciding both here (rather than leaning on the effect
  // above) keeps the two independent of the order they run in.
  // A command already standing when this node is created isn't a press — it's the tree
  // being rebuilt under one.
  let seenSeq = collapseAll.command ? collapseAll.command.seq : 0;
  $effect(() => {
    const cmd = collapseAll.command;
    if (!hasChildren || !cmd) return;
    const isPress = cmd.seq !== seenSeq;
    seenSeq = cmd.seq;
    expanded = cmd.expanded || (!isPress && containsActive());
  });

  const toggle = () => (expanded = !expanded);
  const chevronClass = () =>
    expanded ? "otfw-sidebar-chevron is-open" : "otfw-sidebar-chevron";

  return (
    <li class={hasChildren ? "otfw-sidebar-node otfw-sidebar-group" : "otfw-sidebar-node"}>
      {hasChildren ? (
        item.path ? (
          // Group that is also a page: leading chevron toggles, the link navigates.
          // Chevron on the left mirrors the label-only groups below (no leading dot —
          // the chevron already marks the row).
          <div class="otfw-sidebar-group-row">
            <button
              type="button"
              class="otfw-sidebar-group-toggle otfw-sidebar-group-toggle--icon"
              aria-expanded={expanded ? "true" : "false"}
              aria-controls={panelId}
              aria-label={expanded ? `Collapse ${item.title}` : `Expand ${item.title}`}
              onclick={toggle}
            >
              <svg
                class={chevronClass()}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <Link
              href={item.path}
              class={router.pathname === item.path ? "otfw-sidebar-link otfw-active" : "otfw-sidebar-link"}
            >
              {item.title}
            </Link>
          </div>
        ) : (
          // Section title with no page of its own — the whole row toggles.
          <button
            type="button"
            class="otfw-sidebar-group-toggle"
            aria-expanded={expanded ? "true" : "false"}
            aria-controls={panelId}
            onclick={toggle}
          >
            <svg
              class={chevronClass()}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span class="otfw-sidebar-group-label">{item.title}</span>
          </button>
        )
      ) : item.path ? (
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
      {hasChildren && expanded ? (
        <ul id={panelId} class="otfw-sidebar-sublist">
          {item.items.map((child, i) => (
            <SidebarNode item={child} depth={depth + 1} nodeId={`${nodeId}-${i}`} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
