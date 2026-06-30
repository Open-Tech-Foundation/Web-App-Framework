// <Link href> — client-side (SPA) navigation.
//
// A *pure JSX component*, shipped as source and compiled by the consuming app's
// pipeline (like a UI library ships components for the user's bundler). The
// framework dogfoods its own JSX → Custom Element model here instead of a
// hand-written HTMLElement class — so it gets reactive props, the children slot,
// and a matching SSG renderer for free, with no separate runtime build step.
//
// `class` is a declared prop, so it lands on the rendered <a> (the link), not on
// the <web-link> host — no duplicated styling.

import { localizePath, navigate, shouldInterceptNav } from "../runtime/router.js";

export default function Link({ href, class: className, reload, children }) {
  // Keep the link in the active locale (no-op when i18n is off). Locale is a
  // per-load constant under URL-prefix routing, so resolving it once here is
  // correct — a navigation that changes the locale rebuilds this component.
  const target = localizePath(href);
  // `reload` (a bare attribute → "") forces a full-page navigation for this link.
  // Absent resolves to null (getAttribute), so use loose `!= null` to treat only a
  // present, non-false value as opting out.
  const forceReload = reload != null && reload !== false;

  const onclick = (e) => {
    // Let the browser handle modified clicks (new tab, etc.) and non-primary buttons.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    // Full-page navigation when this link opts out (`reload`) or the app runs in MPA
    // mode (docs/HYDRATION.md §7) — leave the click to the browser.
    if (forceReload || !shouldInterceptNav()) {
      return;
    }
    e.preventDefault();
    navigate(target);
  };

  return (
    <a href={target} class={className} onclick={onclick}>
      {children}
    </a>
  );
}
