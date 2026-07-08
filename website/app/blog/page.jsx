// Blog index — a @opentf/web-docs feature demo, not this project's product blog.
// Linked from the web-docs guide only; omitted from the top nav on purpose.
import { Callout } from "@opentf/web-docs";
import { PostList } from "@opentf/web-docs";
import { posts } from "@opentf/web-docs/posts";

export const metadata = {
  title: "Blog (demo)",
  description:
    "Sample posts demonstrating @opentf/web-docs blog layouts — not OTF Web product news.",
};

export default function BlogIndex() {
  return (
    <div>
      <h1 className="text-4xl font-black tracking-tight text-[var(--text-main)]">
        Blog <span className="text-lg font-bold text-[var(--text-muted)]">(demo)</span>
      </h1>
      <p className="text-[var(--text-muted)] mt-2 mb-4 max-w-2xl">
        These sample posts exist to demonstrate the <code>@opentf/web-docs</code> blog
        feature — post list, banner, reading time, and TOC. This is not the OTF Web
        product blog; the only intentional link here is in the{" "}
        <a href="/docs/packages/web-docs/blog" className="text-[var(--accent)] underline">
          web-docs Blog guide
        </a>
        .
      </p>
      <Callout type="info" title="Demo only">
        Browse <code>website/app/blog/</code> in the repo to see how the demo is wired.
        Your own docs site can omit a blog entirely, or copy this pattern from the
        scaffolder&apos;s Documentation site template.
      </Callout>
      <div className="mt-6">
        <PostList posts={posts} />
      </div>
    </div>
  );
}