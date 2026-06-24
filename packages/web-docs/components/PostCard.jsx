// One post in the blog index: a link to the post with its meta + title + excerpt.
import { Link } from "@opentf/web";
import PostMeta from "./PostMeta.jsx";

export default function PostCard(props) {
  const post = props.post;
  return (
    <Link href={post.path} class={post.cover ? "otfw-post-card otfw-has-cover" : "otfw-post-card"}>
      {post.cover ? (
        <img class="otfw-post-card-cover" src={post.cover} alt={post.title} loading="lazy" />
      ) : null}
      <div class="otfw-post-card-body">
        <PostMeta post={post} />
        <div class="otfw-post-card-title">{post.title}</div>
        {post.description ? <p class="otfw-post-card-desc">{post.description}</p> : null}
      </div>
    </Link>
  );
}
