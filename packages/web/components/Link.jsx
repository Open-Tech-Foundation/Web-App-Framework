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

import { navigate } from "../runtime/router.js";

export default function Link({ href, class: className, children }) {
  const onclick = (e) => {
    // Let the browser handle modified clicks (new tab, etc.) and non-primary buttons.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    navigate(href);
  };

  return (
    <a href={href} class={className} onclick={onclick}>
      {children}
    </a>
  );
}
