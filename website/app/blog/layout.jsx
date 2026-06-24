// Blog section layout — the package's BlogLayout, driven by the generated post list.
// `frame={false}` because the marketing navbar/footer come from the root site layout
// (app/layout.jsx); BlogLayout renders the post banner + "On this page" TOC.
import { BlogLayout } from "@opentf/web-docs";
import { posts } from "@opentf/web-docs/posts";
import config from "../../otfw.config.js";

export default function BlogLayoutRoute(props) {
  return (
    <BlogLayout config={config.docs} posts={posts} frame={false}>
      {props.children}
    </BlogLayout>
  );
}
