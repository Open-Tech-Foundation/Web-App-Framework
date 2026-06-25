// Top-level documentation frame: navbar + (sidebar · content · TOC) + footer.
//
//   import config from "../../otfw.config.js";
//   import nav from "@opentf/web-docs/nav";
//   export default function (props) {
//     return <DocsLayout config={config.docs} nav={nav}>{props.children}</DocsLayout>;
//   }
//
// `nav` is the section map (`{ [base]: tree }`) — every section (`/docs`, `/api`, …) is
// a branch of this same layout, so they share all traits. The layout selects its own
// branch by the current route, so the docs and api layout files are identical bar the
// folder they live in. (A plain array is also accepted, for a single ad-hoc section.)
//
// `frame` (default true) renders the full chrome (navbar + footer). Pass
// `frame={false}` when nesting inside an existing site layout that already provides
// the navbar/footer — only the sidebar · content · TOC grid is rendered.

import { router } from "@opentf/web";
import updated, { editPaths } from "@opentf/web-docs/updated";

import Navbar from "./Navbar.jsx";
import Sidebar from "./Sidebar.jsx";
import Toc from "./Toc.jsx";
import Footer from "./Footer.jsx";
import Breadcrumbs from "./Breadcrumbs.jsx";
import Pagination from "./Pagination.jsx";
import LastUpdated from "./LastUpdated.jsx";

// Code blocks own their copy behavior now: MDX fences compile to the
// `web-internal-code-block` built-in and `<CodeBlock>` wires `onclick` directly, so a
// copy button works in any layout (docs, blog, …) with no delegated listener here.

export default function DocsLayout(props) {
  const config = props.config || {};
  const nav = props.nav || [];
  const frame = props.frame !== false;

  // The sidebar/breadcrumbs/prev-next operate on the *current section's* tree. `nav` is
  // a section map keyed by base path; pick the branch whose base prefixes the route
  // (longest match wins). A bare array means a single, unscoped section. Each section is
  // its own layout instance, so resolving once at mount is correct.
  const sectionNav = pickSection(nav, router.pathname);

  // Last-updated time for the current page, looked up in the build-time map keyed by
  // route (same exact-path match Pagination uses). `$derived` so it tracks navigation.
  const lastUpdated = $derived(updated[router.pathname]);
  // "Edit this page" URL: <repoUrl>/edit/main/<repo-relative file>, when both the repo
  // is configured and the page's source path is known.
  const editUrl = $derived(
    config.repoUrl && editPaths[router.pathname]
      ? `${config.repoUrl.replace(/\/+$/, "")}/edit/main/${editPaths[router.pathname]}`
      : null,
  );

  const body = (
    <div class="otfw-docs">
      <Sidebar nav={sectionNav} config={config} />
      <main id="otfw-content" class="otfw-content" data-pagefind-body>
        <Breadcrumbs nav={sectionNav} />
        <article class="otfw-prose">{props.children}</article>
        {lastUpdated || editUrl ? (
          <div class="otfw-page-meta">
            {lastUpdated ? <LastUpdated date={lastUpdated} /> : null}
            {editUrl ? (
              <a class="otfw-edit-page" href={editUrl} target="_blank" rel="noreferrer">
                Edit this page
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </a>
            ) : null}
          </div>
        ) : null}
        <Pagination nav={sectionNav} />
      </main>
      <Toc />
    </div>
  );

  return frame ? (
    <div class="otfw-shell">
      <Navbar config={config} />
      <div class="otfw-shell-body">{body}</div>
      <Footer config={config} />
    </div>
  ) : (
    body
  );
}

// Resolve the section tree for `pathname` from a `{ [base]: tree }` map. Longest base
// prefix wins ("/" matches anything). Tolerates a bare array (single section).
function pickSection(nav, pathname) {
  if (Array.isArray(nav)) return nav;
  let best = null;
  let bestLen = -1;
  for (const base in nav) {
    const match = base === "/" ? true : pathname === base || pathname.startsWith(base + "/");
    if (match && base.length > bestLen) {
      best = nav[base];
      bestLen = base.length;
    }
  }
  return best || nav[Object.keys(nav)[0]] || [];
}
