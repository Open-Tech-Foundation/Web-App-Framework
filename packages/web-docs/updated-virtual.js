// Fallback for `@opentf/web-docs/updated`.
//
// When `lastUpdatedPlugin` is active (registered when a project opts into
// `docs.lastUpdated` / `blog.lastUpdated`), it intercepts this specifier and replaces
// it with a build-time map of `{ [routePath]: ISO-8601 }` — the last-updated time of
// each page, from git or a frontmatter override. This file is loaded only when the
// plugin is NOT active, in which case the map is empty and the UI omits the line.

export default {};
