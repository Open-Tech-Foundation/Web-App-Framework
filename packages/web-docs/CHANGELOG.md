# @opentf/web-docs

## [Unreleased]

### Added

- **Collapse-all button in the docs sidebar** (`Sidebar.jsx`, `SidebarNode.jsx`, new
  `sidebar-collapse.js`, theme). A small icon button above the nav tree closes every group at
  once; pressing it again expands the whole tree, nested groups included. It renders only when
  the tree has groups, and its icon/label flip between "Collapse all sections" and "Expand all
  sections".

  A press collapses *everything*, the branch you are reading in included — otherwise, on a page
  inside the only open branch, the press would visibly change nothing. Navigating under a
  standing collapse-all is the other case: the tree stays collapsed, but the branch holding the
  new route opens, exactly as it does with the button untouched.

  The button lives in `<Sidebar>` while the open state lives in each recursive `<SidebarNode>`,
  so the two are coupled through a module-scope signal rather than prop-drilling — the same
  decoupling the mobile drawer uses for the navbar burger. State is per-session; a reload
  starts from the derived default.

### Fixed

- **`llms.txt` describes your site, not this framework** (`build/llms.js`, `config.js`). The
  summary line under the title fell back to a hardcoded "Documentation, API reference, and blog
  content for the OTF Web framework." — and nothing ever filled the `docs.description` it read
  first (the key was undocumented, absent from `DocsConfig` and from the `create-web` template),
  so *every* generated `llms.txt`, on every site built with the toolchain, advertised OTF Web to
  the models reading it.

  The line now resolves the site's own description, first hit wins: `docs.description` from
  `otfw.config.js`, the site-wide description the app already resolves for
  `<meta name="description">` (passed in by `otfw build` — see the CLI changelog), the home
  page's frontmatter `description`, `blog.description`, and finally a plain
  `Documentation for <docs.title>.` — a sentence built from your title rather than a blurb about
  ours. `docs.description` is documented in the `DocsConfig` typedef for the sites that want to
  write the line themselves.

## [0.26.0] - 2026-08-12

### Fixed

- **A `_meta.js` edit reaches the sidebar under `otfw dev`** (`build/docs-nav-plugin.js`). The
  nav generator imported each folder's `_meta` with a `?t=<now>` query to defeat the module
  cache; Bun keys ESM by path and ignores the query, so the first version read after the server
  started was the one every rebuild saw — reordering or relabelling a section did nothing until
  the server was restarted (a `_meta.json` was fine: it is read, not imported). The toolchain now
  passes an `importModule` loader that can genuinely re-evaluate the file, and the plugin uses it
  when present. Its `addWatchFile` declarations are also documented for what they are: the only
  link between the generated sidebar and the page frontmatter it was built from.

  The loader comes from `@opentf/web-cli`, so this needs the release of it that passes one;
  with an older CLI the plugin falls back to the plain import it used before, and a build (which
  reads every file once) is unaffected either way.

## [0.25.0] - 2026-07-31

_Dependency updates._

## [0.24.0] - 2026-07-31

### Fixed

- **Wide tables scroll instead of running under the TOC.** The theme drops the table's own block
  margin when it sits in a `.otfw-table-wrap` (the compiler now emits that wrapper for MDX tables,
  so the two no longer stack) and gives the wrapper a focus ring for its keyboard-reachable
  scroll area. `<Table>` is focusable for the same reason.

## [0.23.0] - 2026-07-30

_Dependency updates._

## [0.22.0] - 2026-07-29

_Dependency updates._

## [0.21.0] - 2026-07-25

_Dependency updates._

## [0.20.0] - 2026-07-25

### Fixed

- **`<Toc>` no longer builds its outline twice on first paint.** Effects run at construction,
  before `onMount`, so the route-change effect scheduled a second build of the same headings a
  frame after `onMount` had already built them — the outline was torn down and rebuilt on every
  docs page (59 discarded `.otfw-toc-inner` across the site). The effect now skips its initial
  run and leaves the first build to `onMount`.

### Tests

- The hydration e2e's `known`-failure list is empty: `<Tooltip>`, `<Card>`, `<Cards> > <Card>`
  and both `<BlogLayout>` cases now adopt (or, for a rebuild, keep their slotted content) after
  the slot-marker, `hydrateChild` and conditional-value-local fixes in `@opentf/web` /
  `otfw_compiler`. 126 checks pass across all 12 cases, up from 103 with 23 known failures.

## [0.19.0] - 2026-07-25

### Tests

- **New browser hydration e2e (`tests/e2e/hydration.mjs`) — the gap that let the docs shell ship
  broken twice.** Every other test in this package mounts components through the CSR path, so a
  layout could hydrate-crash in production with the suite fully green. This compiles the real
  `<DocsLayout>` twice with otfwc (`--target=ssg` for the server HTML, `--target=hydrate` for the
  client), serves the pair with the island props payload, and has headless Chromium adopt one
  with the other — asserting, for both `frame={false}` (the docs-site call site) and the default
  framed chrome, that no error is logged, no server node is torn out, and the slotted children
  stay in the prose slot exactly once. It caught the `hydrateSlot` nested-marker bug fixed in
  `@opentf/web`.

## [0.18.0] - 2026-07-24

_Dependency updates._

## [0.17.0] - 2026-07-18

_Dependency updates._

## [0.16.0] - 2026-07-18

_Dependency updates._

## [0.15.0] - 2026-07-08

### Added

- Collapsible sidebar nav groups. A section with children now renders a chevron toggle
  instead of always showing its child list. The branch containing the active route stays
  open and top-level groups start expanded; open/closed state is per-session (no
  persistence). `aria-controls` ids come from a deterministic position path, so they're
  collision-free and hydration-safe.

### Fixed

- The active sidebar item is scrolled into view after navigation. A fresh `<Sidebar>`
  mounts scrolled to the top on each navigation, so in a long nav tree the active link
  landed off-screen; it's now brought into the sidebar's own scroll viewport when out of
  view, adjusting only the sidebar's scroll (never the page's).
- The collapse chevron now left-aligns for every group. Sections that are also their own
  page (e.g. Deployment) previously showed the chevron on the right while label-only
  sections showed it on the left; all chevrons now share one left column.

### Tests

- New browser e2e (`tests/e2e/sidebar-collapse.mjs`) driving headless Chromium over the
  collapsible groups — chevron rotation, child-list layout on expand, reduced-motion
  transition guard, active-branch auto-expand, and active-item scroll-into-view.

## [0.14.0] - 2026-07-08

_Dependency updates._

## [0.13.0] - 2026-07-08

_Dependency updates._

## [0.12.0] - 2026-07-07

_Dependency updates._

## [0.11.0] - 2026-07-07

_Dependency updates._

## [0.10.0] - 2026-07-07

### Tests

- The mobile-drawer browser e2e (`tests/e2e/mobile-drawer.mjs`) replaced fixed settle
  `sleep()`s with a geometry/style probe polled to the drawer's open/close transition
  end-state and the desktop media-query layout — no longer flakes on a slow CI runner.

## [0.9.0] - 2026-07-07

_Dependency updates._

## [0.8.0] - 2026-07-06

_Dependency updates._

## [0.7.0] - 2026-07-06

_Dependency updates._

## [0.6.0] - 2026-07-05

_Dependency updates._

## [0.5.0] - 2026-07-05

_Dependency updates._

## [0.4.0] - 2026-07-05

_Dependency updates._

## [0.3.0] - 2026-07-03

### Added

- `renderLlmsTxt` and `renderLlmsFullTxt` build helpers for generating `/llms.txt`
  and `/llms-full.txt` from filesystem routes.
- Atom 1.0 blog feed rendering via `renderAtomFeed`, alongside the existing RSS
  renderer.

### Changed

- Config docs now mark `site.url` as required for production docs/blog builds unless
  `--base-url` is passed.

### Fixed

- `@opentf/web-docs/updated` now exports an empty `editPaths` fallback when
  last-updated tracking is disabled, so `DocsLayout` builds without the
  last-updated plugin.

## [0.2.0] - 2026-07-01

### Added

- **Mobile navigation drawer + responsive navbar.** Below 768px the sidebar is now
  reachable: it becomes an off-canvas drawer opened by a hamburger button in the navbar
  (shown only on small screens, and only on pages that actually have a sidebar). The
  drawer slides in over a backdrop, locks body scroll while open, and closes on
  navigation, Escape, a backdrop tap, or a resize up to the desktop breakpoint;
  `prefers-reduced-motion` disables the slide. On desktop the same element is the sticky
  column as before. The new `SidebarToggle` (the burger) is decoupled from `Sidebar` the
  way `SearchTrigger` is from `Search` — a global toggle plus an `otfw:sidebar` event
  keep `aria-expanded` in sync — so it works even when the navbar and sidebar live in
  different layouts. To declutter the bar on phones, the navbar collapses to a single
  flex row (brand · compact actions) and its top-level links move **into** the drawer
  (above the section tree) on pages that have one, so the whole nav stays reachable. The
  `data-otfw-has-sidebar` flag is reference-counted, so the burger no longer disappears
  when one section's sidebar replaces another's during SPA navigation.
- Multiple doc sections with **zero config**. Any top-level folder under `app/` that has
  a layout rendering `DocsLayout` is its own section (e.g. `app/api` → `/api`) with its
  own generated sidebar, breadcrumbs, prev/next, search, and `lastUpdated`/edit links —
  the same traits as the main docs. `DocsLayout` now imports the generated nav itself
  (`@opentf/web-docs/nav`, a `{ "/<dir>": tree }` map auto-built per top-level folder) and
  scopes it to the current route, so a section's layout is just
  `<DocsLayout config={config.docs}>{children}</DocsLayout>` — no `nav` prop, no sections
  list. The last-updated/edit map covers every route from the single `lastUpdated` switch.
- `Tooltip` component — a small hover/focus bubble; used on the theme switcher.
- Search trigger shows the open shortcut (`⌘K` on Apple, `Ctrl K` elsewhere); search
  results now lead with the page/post **title** and show the matched section heading
  beneath it, so hits from different pages (or blog posts) are distinguishable.
- Theme switcher is now a subtle dropdown (Light / Dark / System) instead of a 2-state
  toggle. The chosen mode persists; System follows the OS and live-updates. In System
  mode the trigger shows the monitor icon plus a small badge of the resolved icon
  (sun/moon). The trigger is a ghost icon button matching the GitHub action, so the
  navbar's right cluster reads as one aligned row.
- `Cards` / `Card` components — a responsive grid of link tiles for index pages.
- "Edit this page" link on docs pages. When `docs.repoUrl` is set, `lastUpdatedPlugin`
  also emits an `editPaths` map (route → repo-relative file), and `DocsLayout` renders a
  GitHub edit link beside the "Last updated" line.
- Search modal shows a keyboard-shortcut hint (↑↓ navigate · ↵ select · esc close)
  under the input, and blog posts now carry a `breadcrumb` search-meta so a blog result
  reads the same as a docs result.
- "Last updated" per-page timestamps. A new `lastUpdatedPlugin` resolves
  `@opentf/web-docs/updated` to a build-time `{ [routePath]: ISO }` map, sourced from
  each file's **last git commit** (or a `lastUpdated` frontmatter override; `false`
  hides a page) — no file-mtime fallback, so the time always reflects a real content
  change. Opt in with `docs.lastUpdated` / `blog.lastUpdated`. New `<LastUpdated>`
  component; `DocsLayout` renders it under the article, and a blog post shows it only
  when edited after its publish date. `loadLastUpdated` (the callable scan) is exported
  from `@opentf/web-docs/build` for the SSG `article:modified_time` tag. The shared
  `formatDate` helper moved to `components/format.js`.
- Blog RSS feed. `loadPosts({ appDir, contentDir })` (the `blogPostsPlugin`'s scan,
  exposed as a callable) and `renderBlogFeed({ posts, baseUrl, channel })` (a pure RSS
  2.0 renderer) are exported from `@opentf/web-docs/build`. `otfw build` writes
  `<dir>/rss.xml` when `site.url` and a `blog` block are set — posts newest-first with
  absolute links, `<pubDate>` (RFC-822 from `date`), `<dc:creator>` (from `author`), and
  a `<category>` per tag. New `blog.title` / `blog.description` config fields set the
  channel metadata; a `public/<dir>/rss.xml` override is honored.
- Blog support, the marketing-blog counterpart of the docs generator. A `blog` block
  in `defineDocsConfig` turns on a build-time `blogPostsPlugin` that scans
  `app/<dir>/<slug>/page.mdx`, reads each post's frontmatter, computes a reading-time
  estimate, and resolves the virtual module `@opentf/web-docs/posts` to the ordered
  post list (newest-first; a numeric `order` overrides). Frontmatter supported:
  `title`, `description`, `date`, `author`, `author_avatar`, `author_role`, `cover`,
  `tags`, `order`. New components: `BlogLayout` (post banner + prose + reused TOC on a
  post, the listing on the index), `PostList` / `PostCard` (with optional cover
  thumbnails), `PostBanner` (cover image + title + meta), `PostMeta` (date · author
  with avatar · reading time), and `ReadingTime`. Posts are picked up by Pagefind
  search automatically (the post article carries `data-pagefind-body`). New package
  exports `@opentf/web-docs/posts` and `blogPostsPlugin` (from
  `@opentf/web-docs/build`), plus blog theme styles.

### Fixed

- Navbar action icons are now vertically centered. Icons compile to inline custom-
  element hosts that inherited the 1.5 line-height and baseline-aligned the SVG ~3.5px
  high; the icon buttons now zero the line box so flex centering is exact. The version
  badge and the theme menu rows are likewise corrected (badge uses inline-flex centering;
  menu items are full-width so the whole row is clickable). The System-mode trigger gets
  breathing room between the monitor and the resolved sun/moon icon.
- A `null`-returning component is no longer instantiated by the layout — `LastUpdated`
  renders only when there's a date, so SSG never serializes the literal string "null"
  into an otherwise-empty page-meta slot.
- Blog post TOC now stays pinned while scrolling. The TOC column is a `<web-toc>`
  custom-element host, and the blog post grid set `align-items: start`, so the host
  shrank to its content height and its inner `position: sticky` nav had no travel room
  — it scrolled away with the page. Dropping `align-items: start` lets the host stretch
  to the row height (as in the docs grid), so the TOC sticks.
- Code-block copy buttons now work in any layout, not just the docs shell. `CodeBlock`
  wires its own `onclick` (and MDX fences use the self-wiring `web-internal-code-block`
  built-in), so the delegated copy listener that lived in `DocsLayout` — and silently
  did nothing outside it — is gone.

### Changed

- Navbar version badge now uses neutral surface / muted-text / border styling instead
  of the theme accent color, so it reads as metadata rather than a call to action.
