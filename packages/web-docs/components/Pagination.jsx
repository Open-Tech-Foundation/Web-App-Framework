// Prev / next page links, derived from a depth-first flatten of the nav tree.

import { Link, router } from "@opentf/web";

export default function Pagination(props) {
  const nav = props.nav || [];

  return (
    <nav class="otfw-pagination" aria-label="Pagination">
      {() => {
        const flat = [];
        const walk = (items) => {
          for (const it of items) {
            if (it.path) flat.push(it);
            if (it.items) walk(it.items);
          }
        };
        walk(nav);
        const i = flat.findIndex((x) => x.path === router.pathname);
        const prev = i > 0 ? flat[i - 1] : null;
        const next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
        return (
          <>
            {prev ? (
              <Link href={prev.path} class="otfw-page-link otfw-page-prev">
                <span class="otfw-page-dir">← Previous</span>
                <span class="otfw-page-title">{prev.title}</span>
              </Link>
            ) : (
              <span class="otfw-page-spacer" />
            )}
            {next ? (
              <Link href={next.path} class="otfw-page-link otfw-page-next">
                <span class="otfw-page-dir">Next →</span>
                <span class="otfw-page-title">{next.title}</span>
              </Link>
            ) : (
              <span class="otfw-page-spacer" />
            )}
          </>
        );
      }}
    </nav>
  );
}
