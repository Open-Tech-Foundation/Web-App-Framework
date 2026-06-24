// The blog index listing: renders a PostCard per post. Pass the list from
// `@opentf/web-docs/posts`:
//
//   import { posts } from "@opentf/web-docs/posts";
//   <PostList posts={posts} />
import PostCard from "./PostCard.jsx";

export default function PostList(props) {
  const posts = props.posts || [];
  // The `.map` is a direct child (compiles to a keyed list); the empty state is a
  // separate sibling conditional. A `.map` nested *inside* a ternary currently loses
  // its item binding, so keep them apart.
  return (
    <div class="otfw-post-list">
      {posts.map((post) => <PostCard post={post} />)}
      {posts.length === 0 ? <p class="otfw-post-empty">No posts yet.</p> : null}
    </div>
  );
}
