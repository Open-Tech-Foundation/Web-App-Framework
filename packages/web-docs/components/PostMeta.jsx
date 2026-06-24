// A post's metadata row: date · author · reading time. Pass a post record (from
// `@opentf/web-docs/posts`) as `post`, or the fields directly. Missing fields are
// omitted. Used in both the post banner and the index cards.
import ReadingTime from "./ReadingTime.jsx";

// `2026-06-24` → `June 24, 2026`. Falls back to the raw string for anything the
// Date constructor can't parse, so a non-ISO `date` still renders.
function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function PostMeta(props) {
  const post = props.post || props;
  return (
    <div class="otfw-post-meta">
      {post.author ? (
        <span class="otfw-post-author">
          {post.authorAvatar ? (
            <img class="otfw-post-avatar" src={post.authorAvatar} alt={post.author} loading="lazy" />
          ) : null}
          <span class="otfw-post-author-name">{post.author}</span>
          {post.authorRole ? <span class="otfw-post-author-role">{post.authorRole}</span> : null}
        </span>
      ) : null}
      {post.date ? (
        <time class="otfw-post-date" datetime={String(post.date)}>
          {formatDate(post.date)}
        </time>
      ) : null}
      {post.readingTime ? <ReadingTime minutes={post.readingTime} /> : null}
    </div>
  );
}
