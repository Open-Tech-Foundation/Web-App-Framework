// A blog post's header: title, optional description, and the metadata row. Rendered
// by BlogLayout above the post's prose body, driven by the post record so the MDX
// file stays pure content (no hand-written title/date in the body).
import PostMeta from "./PostMeta.jsx";

export default function PostBanner(props) {
  const post = props.post || props;
  return (
    <header class="otfw-post-banner">
      {post.cover ? (
        <img class="otfw-post-cover" src={post.cover} alt={post.title} />
      ) : null}
      <h1 class="otfw-post-title">{post.title}</h1>
      {post.description ? <p class="otfw-post-desc">{post.description}</p> : null}
      <PostMeta post={post} />
      {post.tags && post.tags.length ? (
        <div class="otfw-post-tags">
          {post.tags.map((tag) => (
            <span class="otfw-post-tag">{tag}</span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
