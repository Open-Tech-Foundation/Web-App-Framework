// Documentation sidebar — renders the build-time nav tree (from
// `@opentf/web-docs/nav`). Static content (crawlable with JS off); the active link
// updates reactively in SidebarNode.
//
// On desktop it is the sticky left column of the docs grid. On mobile (< 768px) the
// same element becomes an off-canvas drawer: hidden off-screen, slid in over a
// backdrop. The drawer is opened by the navbar hamburger, which lives in a different
// component (and, on the website, a different layout), so the two are coupled the same
// way Search/SearchTrigger are — through a global toggle installed here:
//
//   • `window.__otfwToggleSidebar()` / `__otfwCloseSidebar()` — called by the burger.
//   • `document.documentElement[data-otfw-has-sidebar]` — set while a Sidebar is
//     mounted, so the burger shows only on pages that actually have one.
//   • a `otfw:sidebar` CustomEvent (`{ open }`) — lets the burger mirror `aria-expanded`.
//
// The drawer closes on navigation, Escape, backdrop click, or a viewport resize up to
// the desktop breakpoint, and locks body scroll while open.

import { onMount, router } from "@opentf/web";

import SidebarNode from "./SidebarNode.jsx";
import NavbarLink from "./NavbarLink.jsx";

const DESKTOP_QUERY = "(min-width: 768px)";

// How many Sidebars are mounted right now. On SPA navigation a new section's Sidebar can
// mount *before* the old one unmounts, so the burger's `data-otfw-has-sidebar` flag must
// be reference-counted — otherwise the departing instance's cleanup would clear the flag
// the arriving instance just set, and the burger would vanish after navigating.
let liveSidebars = 0;

export default function Sidebar(props) {
  const nav = props.nav || [];
  // Top-level site links (config.nav). On desktop they live in the navbar; on mobile the
  // navbar hides them and the drawer surfaces them above the section tree, so the whole
  // nav is reachable from one place.
  const navLinks = (props.config && props.config.nav) || [];
  let open = $state(false);

  const close = () => (open = false);
  // Stable per-instance toggle so cleanup can tell whether the global still points at us.
  const toggle = () => (open = !open);

  onMount(() => {
    const root = document.documentElement;
    liveSidebars += 1;
    root.setAttribute("data-otfw-has-sidebar", "");

    // The burger (navbar) drives the drawer through these globals — same decoupling as
    // the Search modal's `__otfwOpenSearch`. The latest-mounted Sidebar owns them.
    window.__otfwToggleSidebar = toggle;
    window.__otfwCloseSidebar = close;

    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);

    // If the viewport grows to desktop while the drawer is open, drop the drawer state
    // (CSS turns the element back into the sticky column; this releases the scroll lock
    // and resyncs the burger).
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onDesktop = (e) => e.matches && close();
    mql.addEventListener?.("change", onDesktop);

    return () => {
      window.removeEventListener("keydown", onKey);
      mql.removeEventListener?.("change", onDesktop);
      document.body.style.removeProperty("overflow");
      root.removeAttribute("data-otfw-sidebar-open");
      // Only drop the flag/globals if we're the last Sidebar and still the owner — an
      // arriving instance may already have taken over during navigation.
      liveSidebars -= 1;
      if (liveSidebars <= 0) {
        liveSidebars = 0;
        root.removeAttribute("data-otfw-has-sidebar");
      }
      if (window.__otfwToggleSidebar === toggle) delete window.__otfwToggleSidebar;
      if (window.__otfwCloseSidebar === close) delete window.__otfwCloseSidebar;
    };
  });

  // Reflect open state: lock body scroll, mark the root (for styling), and notify the
  // burger so it can mirror `aria-expanded`. Reading `open` (not writing it) keeps this
  // effect free of the route/resize effects.
  $effect(() => {
    const isOpen = open;
    if (typeof document === "undefined") return;
    document.documentElement.toggleAttribute("data-otfw-sidebar-open", isOpen);
    document.body.style.overflow = isOpen ? "hidden" : "";
    window.dispatchEvent(new CustomEvent("otfw:sidebar", { detail: { open: isOpen } }));
  });

  // Close on navigation — clicking a drawer link should dismiss it.
  $effect(() => {
    router.pathname; // subscribe
    close();
  });

  return (
    <div class="otfw-sidebar-shell">
      <div
        class={open ? "otfw-sidebar-backdrop is-open" : "otfw-sidebar-backdrop"}
        onclick={close}
        aria-hidden="true"
      ></div>
      <aside id="otfw-sidebar" class={open ? "otfw-sidebar is-open" : "otfw-sidebar"}>
        {navLinks.length ? (
          <nav class="otfw-drawer-links" aria-label="Site">
            {navLinks.map((link) => (
              <NavbarLink link={link} />
            ))}
          </nav>
        ) : null}
        <nav class="otfw-sidebar-nav" aria-label="Documentation">
          <ul class="otfw-sidebar-list">
            {nav.map((item, i) => (
              <SidebarNode item={item} nodeId={String(i)} />
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
