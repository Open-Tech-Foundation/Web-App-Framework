// RSS/Atom feed generation for the blog. Pure, build-time counterparts to the
// sitemap: given the post list (from `loadPosts`) plus the site origin and channel
// metadata, render feed XML strings. The web-cli build writes them to
// `dist/<blogDir>/rss.xml` and `dist/<blogDir>/atom.xml` when a base URL is configured.
//
// RSS 2.0 (https://www.rssboard.org/rss-specification) is the lowest-common-
// denominator feed format: every reader supports it, and `<pubDate>` must be RFC-822.

/** XML text-escape (the five predefined entities). */
function esc(s) {
  return String(s).replace(/[&<>'"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/** Absolute URL from a (trailing-slash-trimmed) origin + an absolute path. */
function abs(baseUrl, path) {
  return baseUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

/** `YYYY-MM-DD` (or any Date-parseable string) → RFC-822, e.g. for `<pubDate>`. */
function rfc822(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

/** `YYYY-MM-DD` (or any Date-parseable string) -> ISO-8601 for Atom timestamps. */
function iso8601(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Render an RSS 2.0 feed.
 *
 * @param {Object} opts
 * @param {Array}  opts.posts        Post list (from `loadPosts`).
 * @param {string} opts.baseUrl      Canonical site origin (required; absolute links).
 * @param {string} [opts.feedPath]   Path of the feed itself (for `<atom:link rel=self>`).
 * @param {Object} [opts.channel]    `{ title, description, link, language }`.
 * @returns {string} The `rss.xml` document.
 */
export function renderBlogFeed({ posts = [], baseUrl, feedPath = "/blog/rss.xml", channel = {} } = {}) {
  const title = channel.title || "Blog";
  const description = channel.description || title;
  const link = channel.link ? abs(baseUrl, channel.link) : abs(baseUrl, "/blog");
  const language = channel.language || "en";
  const self = abs(baseUrl, feedPath);
  const lastBuild = rfc822(posts.find((p) => p.date)?.date) || new Date().toUTCString();

  const items = posts
    .map((p) => {
      const url = abs(baseUrl, p.path);
      const pubDate = rfc822(p.date);
      const parts = [
        `      <title>${esc(p.title)}</title>`,
        `      <link>${esc(url)}</link>`,
        `      <guid isPermaLink="true">${esc(url)}</guid>`,
      ];
      if (pubDate) parts.push(`      <pubDate>${pubDate}</pubDate>`);
      if (p.author) parts.push(`      <dc:creator>${esc(p.author)}</dc:creator>`);
      if (p.description) parts.push(`      <description>${esc(p.description)}</description>`);
      for (const tag of p.tags || []) parts.push(`      <category>${esc(tag)}</category>`);
      return `    <item>\n${parts.join("\n")}\n    </item>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `  <channel>\n` +
    `    <title>${esc(title)}</title>\n` +
    `    <link>${esc(link)}</link>\n` +
    `    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>\n` +
    `    <description>${esc(description)}</description>\n` +
    `    <language>${esc(language)}</language>\n` +
    `    <lastBuildDate>${lastBuild}</lastBuildDate>\n` +
    `    <generator>@opentf/web-docs</generator>\n` +
    (items ? items + "\n" : "") +
    `  </channel>\n` +
    `</rss>\n`
  );
}

/**
 * Render an Atom 1.0 feed.
 *
 * @param {Object} opts
 * @param {Array}  opts.posts        Post list (from `loadPosts`).
 * @param {string} opts.baseUrl      Canonical site origin (required; absolute links).
 * @param {string} [opts.feedPath]   Path of the feed itself (for `<link rel=self>`).
 * @param {Object} [opts.channel]    `{ title, description, link, author }`.
 * @returns {string} The `atom.xml` document.
 */
export function renderAtomFeed({ posts = [], baseUrl, feedPath = "/blog/atom.xml", channel = {} } = {}) {
  const title = channel.title || "Blog";
  const description = channel.description || title;
  const link = channel.link ? abs(baseUrl, channel.link) : abs(baseUrl, "/blog");
  const self = abs(baseUrl, feedPath);
  const updated = iso8601(posts.find((p) => p.date)?.date) || new Date().toISOString();
  const fallbackAuthor = channel.author || title;

  const entries = posts
    .map((p) => {
      const url = abs(baseUrl, p.path);
      const published = iso8601(p.date);
      const parts = [
        `    <title>${esc(p.title)}</title>`,
        `    <link href="${esc(url)}"/>`,
        `    <id>${esc(url)}</id>`,
        `    <updated>${published || updated}</updated>`,
      ];
      if (published) parts.push(`    <published>${published}</published>`);
      parts.push(`    <author><name>${esc(p.author || fallbackAuthor)}</name></author>`);
      if (p.description) parts.push(`    <summary>${esc(p.description)}</summary>`);
      for (const tag of p.tags || []) parts.push(`    <category term="${esc(tag)}"/>`);
      return `  <entry>\n${parts.join("\n")}\n  </entry>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>${esc(title)}</title>\n` +
    `  <subtitle>${esc(description)}</subtitle>\n` +
    `  <link href="${esc(link)}"/>\n` +
    `  <link href="${esc(self)}" rel="self" type="application/atom+xml"/>\n` +
    `  <id>${esc(link)}</id>\n` +
    `  <updated>${updated}</updated>\n` +
    `  <generator>@opentf/web-docs</generator>\n` +
    (entries ? entries + "\n" : "") +
    `</feed>\n`
  );
}
