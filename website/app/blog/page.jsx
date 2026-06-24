// The /blog index: the package's PostList over the generated post list.
import { PostList } from "@opentf/web-docs";
import { posts } from "@opentf/web-docs/posts";

export const metadata = {
  title: "Blog",
  description: "News, releases, and writing about OTF Web.",
};

export default function BlogIndex() {
  return (
    <div>
      <h1 className="text-4xl font-black tracking-tight text-[var(--text-main)]">Blog</h1>
      <p className="text-[var(--text-muted)] mt-2 mb-6">News, releases, and writing about OTF Web.</p>
      <PostList posts={posts} />
    </div>
  );
}
