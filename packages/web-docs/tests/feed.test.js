import { describe, expect, test } from "bun:test";

import { renderAtomFeed, renderBlogFeed } from "../build/feed.js";

const posts = [
  {
    path: "/blog/hello",
    title: "Hello <World>",
    description: "News & notes",
    date: "2026-07-02",
    author: "Ada",
    tags: ["release", "docs"],
  },
];

describe("renderBlogFeed", () => {
  test("renders RSS with an absolute self link and escaped post metadata", () => {
    const xml = renderBlogFeed({
      posts,
      baseUrl: "https://example.com/",
      feedPath: "/blog/rss.xml",
      channel: { title: "Example Blog", description: "Updates", link: "/blog" },
    });

    expect(xml).toContain(`<rss version="2.0"`);
    expect(xml).toContain(`<atom:link href="https://example.com/blog/rss.xml" rel="self" type="application/rss+xml"/>`);
    expect(xml).toContain(`<title>Hello &lt;World&gt;</title>`);
    expect(xml).toContain(`<description>News &amp; notes</description>`);
    expect(xml).toContain(`<category>release</category>`);
  });
});

describe("renderAtomFeed", () => {
  test("renders Atom entries with absolute links, ISO dates, and escaped metadata", () => {
    const xml = renderAtomFeed({
      posts,
      baseUrl: "https://example.com/",
      feedPath: "/blog/atom.xml",
      channel: { title: "Example Blog", description: "Updates", link: "/blog" },
    });

    expect(xml).toContain(`<feed xmlns="http://www.w3.org/2005/Atom">`);
    expect(xml).toContain(`<link href="https://example.com/blog/atom.xml" rel="self" type="application/atom+xml"/>`);
    expect(xml).toContain(`<link href="https://example.com/blog/hello"/>`);
    expect(xml).toContain(`<title>Hello &lt;World&gt;</title>`);
    expect(xml).toContain(`<summary>News &amp; notes</summary>`);
    expect(xml).toContain(`<published>2026-07-02T00:00:00.000Z</published>`);
    expect(xml).toContain(`<author><name>Ada</name></author>`);
    expect(xml).toContain(`<category term="docs"/>`);
  });
});
