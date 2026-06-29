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

const DESKTOP_QUERY = "(min-width: 768px)";

export default function Sidebar(props) {
  const nav = props.nav || [];
  let open = $state(false);

  const close = () => (open = false);

  onMount(() => {
    const root = document.documentElement;
    root.setAttribute("data-otfw-has-sidebar", "");

    // The burger (navbar) drives the drawer through these globals — same decoupling as
    // the Search modal's `__otfwOpenSearch`.
    window.__otfwToggleSidebar = () => (open = !open);
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
      root.removeAttribute("data-otfw-has-sidebar");
      root.removeAttribute("data-otfw-sidebar-open");
      document.body.style.removeProperty("overflow");
      if (window.__otfwCloseSidebar === close) delete window.__otfwCloseSidebar;
      delete window.__otfwToggleSidebar;
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
        <nav class="otfw-sidebar-nav" aria-label="Documentation">
          <ul class="otfw-sidebar-list">
            {nav.map((item) => (
              <SidebarNode item={item} />
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
