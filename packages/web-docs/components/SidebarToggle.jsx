// Hamburger button in the navbar that opens the mobile sidebar drawer. Like
// SearchTrigger, it is decoupled from the thing it controls: the <Sidebar> installs
// `window.__otfwToggleSidebar` and emits an `otfw:sidebar` event, so this button works
// even when the navbar and the sidebar live in different layouts (the website renders
// the navbar at its root, the sidebar only inside the docs/api sections).
//
// The button is hidden by default and revealed by CSS only on small screens and only
// while a Sidebar is mounted (`:root[data-otfw-has-sidebar]`), so it never shows on a
// page without a drawer (e.g. the marketing home).

import { onMount } from "@opentf/web";

export default function SidebarToggle() {
  let expanded = $state(false);

  onMount(() => {
    // Mirror the drawer's real state so aria-expanded stays correct however it was
    // toggled (button, backdrop, Escape, navigation, resize).
    const onState = (e) => (expanded = !!(e.detail && e.detail.open));
    window.addEventListener("otfw:sidebar", onState);
    return () => window.removeEventListener("otfw:sidebar", onState);
  });

  const toggle = () => window.__otfwToggleSidebar?.();

  return (
    <button
      class="otfw-navbar-icon otfw-navbar-burger"
      onclick={toggle}
      aria-label="Toggle navigation"
      aria-controls="otfw-sidebar"
      aria-expanded={expanded ? "true" : "false"}
    >
      {() =>
        expanded ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        )
      }
    </button>
  );
}
