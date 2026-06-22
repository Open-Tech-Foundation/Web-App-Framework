// Breadcrumb trail for the current page, derived from the nav tree + router path.

import { Link, router } from "@opentf/web";

export default function Breadcrumbs(props) {
  const nav = props.nav || [];

  return (
    <nav class="otfw-breadcrumbs" aria-label="Breadcrumb">
      {() => {
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
        const trail = findTrail(nav, router.pathname, []) || [];
        return trail.map((it, i) => (
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
        ));
      }}
    </nav>
  );
}
