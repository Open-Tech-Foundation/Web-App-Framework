// Blog section layout. Wraps both the index (`/blog`) and individual posts
// (`/blog/<slug>`). It identifies the current page by matching `router.pathname`
// against the post list (from `@opentf/web-docs/posts`):
//
//   import BlogLayout from "@opentf/web-docs"; // BlogLayout
//   import { posts } from "@opentf/web-docs/posts";
//   import config from "../../otfw.config.js";
//   export default function (props) {
//     return <BlogLayout config={config.docs} posts={posts} frame={false}>{props.children}</BlogLayout>;
//   }
//
// On a post it renders the PostBanner (from the post's frontmatter) above the prose
// body, plus a reusable "On this page" TOC; on the index it just renders the children
// (typically a <PostList/>). `frame` (default true) adds the navbar/footer chrome;
// pass `frame={false}` when nesting inside a site layout that already provides them.
//
// The layout factory re-runs on every navigation (the router rebuilds the route +
// layout chain), so reading `router.pathname` resolves to the page being shown.
import { Link, router } from "@opentf/web";

import Navbar from "./Navbar.jsx";
import Footer from "./Footer.jsx";
import Toc from "./Toc.jsx";
import PostBanner from "./PostBanner.jsx";

export default function BlogLayout(props) {
  const config = props.config || {};
  const posts = props.posts || [];
  const frame = props.frame !== false;
  const indexPath = props.indexPath || "/blog";

  const post = posts.find((p) => p.path === router.pathname);

  const body = post ? (
    <div class="otfw-blog otfw-blog-post">
      {/* `otfw-content` so the shared Toc can read this article's headings. */}
      <main id="otfw-content" class="otfw-blog-main" data-pagefind-body>
        <Link href={indexPath} class="otfw-blog-back">
          ← {config.title ? `${config.title} Blog` : "Blog"}
        </Link>
        <PostBanner post={post} />
        <article class="otfw-prose">{props.children}</article>
      </main>
      <Toc />
    </div>
  ) : (
    <div class="otfw-blog otfw-blog-index">
      <main class="otfw-blog-main">{props.children}</main>
    </div>
  );

  return frame ? (
    <div class="otfw-shell">
      <Navbar config={config} />
      <div class="otfw-shell-body">{body}</div>
      <Footer config={config} />
    </div>
  ) : (
    body
  );
}
