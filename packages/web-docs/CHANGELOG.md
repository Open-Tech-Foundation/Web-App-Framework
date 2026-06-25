# @opentf/web-docs

## [Unreleased]

### Added

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
