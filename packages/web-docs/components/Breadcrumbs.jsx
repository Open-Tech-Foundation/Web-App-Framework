// Breadcrumb trail for the current page, derived from the nav tree + router path.

import { Link, router } from "@opentf/web";

export default function Breadcrumbs(props) {
  const nav = props.nav || [];

  const findTrail = (items, path, trail) => {
    for (const it of items) {
      const next = trail.concat(it);
      if (it.path === path) return next;
      if (it.items) {
        const found = findTrail(it.items, path, next);
        if (found) return found;
      }
    }
    return null;
  };

  // Direct-child `.map` (not wrapped in a `{() => …}` thunk) so the compiler
  // lowers it to a reactive list whose item renderer receives `it`/`i`. The
  // source re-runs on `router.pathname`, so the trail tracks navigation.
  // `data-pagefind-meta="breadcrumb"` exposes this trail to the search index, so each
  // result can show which page (and section) it belongs to.
  return (
    <nav class="otfw-breadcrumbs" aria-label="Breadcrumb" data-pagefind-meta="breadcrumb">
      {(findTrail(nav, router.pathname, []) || []).map((it, i) => (
        <span class="otfw-crumb">
          {i > 0 ? <span class="otfw-crumb-sep">/</span> : null}
          {it.path ? (
            <Link href={it.path} class="otfw-crumb-link">
              {it.title}
            </Link>
          ) : (
            <span class="otfw-crumb-text">{it.title}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
