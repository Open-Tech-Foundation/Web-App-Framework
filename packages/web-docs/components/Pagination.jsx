// Prev / next page links, derived from a depth-first flatten of the nav tree.

import { Link, router } from "@opentf/web";

export default function Pagination(props) {
  const nav = props.nav || [];

  const flat = [];
  const walk = (items) => {
    for (const it of items) {
      if (it.path) flat.push(it);
      if (it.items) walk(it.items);
    }
  };
  walk(nav);

  const adjacent = (path) => {
    const i = flat.findIndex((x) => x.path === path);
    return {
      prev: i > 0 ? flat[i - 1] : null,
      next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null,
    };
  };

  // A single reactive signal (not a `{() => …}` thunk): `pos` is in scope for the
  // hoisted branch builders, and recomputes on `router.pathname`.
  const pos = $derived(adjacent(router.pathname));

  return (
    <nav class="otfw-pagination" aria-label="Pagination">
      {pos.prev ? (
        <Link href={pos.prev?.path} class="otfw-page-link otfw-page-prev">
          <span class="otfw-page-dir">← Previous</span>
          <span class="otfw-page-title">{pos.prev?.title}</span>
        </Link>
      ) : (
        <span class="otfw-page-spacer" />
      )}
      {pos.next ? (
        <Link href={pos.next?.path} class="otfw-page-link otfw-page-next">
          <span class="otfw-page-dir">Next →</span>
          <span class="otfw-page-title">{pos.next?.title}</span>
        </Link>
      ) : (
        <span class="otfw-page-spacer" />
      )}
    </nav>
  );
}
