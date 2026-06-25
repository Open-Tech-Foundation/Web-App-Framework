// "Last updated" resolution for a page file. Two sources only (build time):
//
//   1. A frontmatter override — `lastUpdated: 2026-06-25` (any Date-parseable value)
//      pins the date; `lastUpdated: false` hides it for that page.
//   2. The file's last git commit (committer date, `git log -1 --format=%cI`).
//
// No file-mtime fallback: mtime is noise (a checkout/copy bumps it), so when the file
// isn't in git history the value is simply null and the UI omits it. This runs in dev
// and build alike — the displayed time is always the real last content change.

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

/** Last git commit (committer ISO-8601) that touched `file`, or null. */
export function gitLastUpdated(file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
      cwd: dirname(file),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null; // empty = untracked / no history (e.g. a shallow CI clone)
  } catch {
    return null; // not a git repo / git unavailable
  }
}

/** Normalize a frontmatter override to ISO-8601, or keep the raw string if unparseable. */
function normalize(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/**
 * Resolve a page's last-updated timestamp.
 *
 * @param {string} file            Absolute path to the page file.
 * @param {*}      [frontmatter]   The frontmatter `lastUpdated` value, if any.
 * @returns {string|null} ISO-8601 (or a raw override string), or null to omit.
 */
export function resolveLastUpdated(file, frontmatter) {
  if (frontmatter === false) return null; // explicit opt-out for this page
  if (frontmatter != null && frontmatter !== true) return normalize(frontmatter);
  return gitLastUpdated(file);
}
