// The blog index listing: renders a PostCard per post. Pass the list from
// `@opentf/web-docs/posts`:
//
//   import { posts } from "@opentf/web-docs/posts";
//   <PostList posts={posts} />
import PostCard from "./PostCard.jsx";

export default function PostList(props) {
  const posts = props.posts || [];
  return (
    <div class="otfw-post-list">
      {posts.length
        ? posts.map((post) => <PostCard post={post} />)
        : <p class="otfw-post-empty">No posts yet.</p>}
    </div>
  );
}
