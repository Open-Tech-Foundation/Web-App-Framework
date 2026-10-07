// Date rules shared by the blog components.

/** The UTC calendar day of a date value as `YYYY-MM-DD`, or `null` when invalid. */
function utcDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * True when a post was edited on a later calendar day than it was published, so a
 * "Last updated" line adds information. An update on the publish day, or one dated
 * before publication (a stale git timestamp, a backdated post), shows nothing.
 * Days compare in UTC because a frontmatter `date: 2026-10-03` parses as UTC midnight.
 * Without a valid publish date, any valid update is shown.
 */
export function editedAfterPublish(updated, published) {
  const updatedDay = updated ? utcDay(updated) : null;
  if (!updatedDay) return false;
  const publishedDay = published ? utcDay(published) : null;
  return !publishedDay || updatedDay > publishedDay;
}
