// Breadcrumb trail for the current page, derived from the nav tree + router path.

import { Link, RawHtml, router } from "@opentf/web";

// Structured data for crawlers: the visible trail above as a BreadcrumbList.
// Emitted beside the nav (JSON-LD is discovered wherever it sits). `siteUrl`
// (optional site origin) absolutizes the item URLs; without it they stay
// route-relative. `<` is escaped so the payload can't break out of the script.
function breadcrumbJsonLd(trail, siteUrl) {
  if (!trail.length) return "";
  const base = (siteUrl || "").replace(/\/+$/, "");
  const items = trail.map((it, i) => {
    const entry = {
      "@type": "ListItem",
      position: i + 1,
      name: it.title,
    };
    if (it.path) entry.item = base + it.path;
    return entry;
  });
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

export default function Breadcrumbs(props) {
  const nav = props.nav || [];
  const siteUrl = props.siteUrl || "";

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
  // `data-otf-search-meta="breadcrumb"` exposes this trail to the search index, so each
  // result can show which page (and section) it belongs to.
  // The JSON-LD trail below re-reads the same source (a second subscription, kept
  // out of the list so the lowering above is untouched).
  return (
    <nav class="otfw-breadcrumbs" aria-label="Breadcrumb" data-otf-search-meta="breadcrumb">
      <RawHtml
        html={breadcrumbJsonLd(findTrail(nav, router.pathname, []) || [], siteUrl)}
      />
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
