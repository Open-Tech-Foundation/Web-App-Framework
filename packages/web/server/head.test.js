import { afterEach, describe, expect, test } from "bun:test";

import { registerRoutes, routes } from "../runtime/router.js";
import { renderHead, resolveMetadata } from "./head.js";

afterEach(() => {
  routes.pages = {};
  routes.layouts = {};
  routes.notFound = null;
});

describe("resolveMetadata (layout → page → generateMetadata merge)", () => {
  test("merges layout defaults under page metadata, deep-merging sub-objects", async () => {
    registerRoutes({
      "/app/layout.jsx": {
        default: () => "",
        metadata: { title: "Site", openGraph: { siteName: "Site", type: "website" } },
      },
      "/app/about/page.jsx": {
        default: () => "",
        metadata: { title: "About", openGraph: { image: "/a.png" } },
      },
    });
    const meta = await resolveMetadata({ route: "/about", entry: routes.pages["/about"] });
    expect(meta.title).toBe("About"); // page overrides layout
    expect(meta.openGraph).toEqual({ siteName: "Site", type: "website", image: "/a.png" });
  });

  test("entry: null resolves the layout chain only (the CSR shell head contract)", async () => {
    registerRoutes({
      "/app/layout.jsx": {
        default: () => "",
        metadata: { description: "Site default", links: [{ rel: "icon", href: "/favicon.svg" }] },
      },
      "/app/page.jsx": { default: () => "", metadata: { title: "Home", canonical: "/" } },
    });
    const meta = await resolveMetadata({ route: "/", entry: null });
    expect(meta.description).toBe("Site default");
    expect(meta.links).toEqual([{ rel: "icon", href: "/favicon.svg" }]);
    expect(meta.title).toBeUndefined(); // no page → no route-specific title
    expect(meta.canonical).toBeUndefined();
  });

  test("generateMetadata wins over static metadata and sees params", async () => {
    const entry = {
      default: () => "",
      metadata: { title: "static" },
      generateMetadata: ({ params }) => ({ title: `Post ${params.id}` }),
    };
    const meta = await resolveMetadata({ route: "/post/[id]", entry, params: { id: "9" } });
    expect(meta.title).toBe("Post 9");
  });
});

describe("renderHead", () => {
  test("emits title, description, canonical, OG and Twitter tags", () => {
    const html = renderHead(
      { title: "About", description: "desc", canonical: "/about" },
      { path: "/about", baseUrl: "https://x.com" },
    );
    expect(html).toContain("<title>About</title>");
    expect(html).toContain('<meta name="description" content="desc">');
    expect(html).toContain('<link rel="canonical" href="https://x.com/about">');
    expect(html).toContain('<meta property="og:title" content="About">');
    expect(html).toContain('<meta property="og:url" content="https://x.com/about">');
    expect(html).toContain('<meta name="twitter:title" content="About">');
  });

  test("applies titleTemplate to a string title and uses it for OG/Twitter", () => {
    const html = renderHead({ title: "Installation", titleTemplate: "%s — OTF Web" }, {});
    expect(html).toContain("<title>Installation — OTF Web</title>");
    expect(html).toContain('<meta property="og:title" content="Installation — OTF Web">');
    expect(html).toContain('<meta name="twitter:title" content="Installation — OTF Web">');
  });

  test("an absolute title bypasses the titleTemplate", () => {
    const html = renderHead(
      { title: { absolute: "OTF Web — native-first" }, titleTemplate: "%s — OTF Web" },
      {},
    );
    expect(html).toContain("<title>OTF Web — native-first</title>");
  });

  test("canonical falls back to the route path when not set", () => {
    const html = renderHead({}, { path: "/p", baseUrl: "https://x.com" });
    expect(html).toContain('<link rel="canonical" href="https://x.com/p">');
  });

  test("emits links[].type (e.g. an RSS alternate feed)", () => {
    const html = renderHead(
      { links: [{ rel: "alternate", type: "application/rss+xml", href: "/blog/rss.xml" }] },
      { baseUrl: "https://x.com" },
    );
    expect(html).toContain(
      '<link rel="alternate" type="application/rss+xml" href="https://x.com/blog/rss.xml">',
    );
  });

  test("route-independent head (path: null) omits canonical and og:url", () => {
    const html = renderHead(
      { description: "site-wide", links: [{ rel: "icon", href: "/favicon.svg" }], openGraph: { siteName: "Site" } },
      { path: null, baseUrl: "https://x.com" },
    );
    // Site-wide layout defaults are kept…
    expect(html).toContain('<meta name="description" content="site-wide">');
    expect(html).toContain('<link rel="icon" href="https://x.com/favicon.svg">');
    expect(html).toContain('<meta property="og:site_name" content="Site">');
    // …but no route-specific canonical / og:url is stamped on the shared shell.
    expect(html).not.toContain("canonical");
    expect(html).not.toContain("og:url");
  });

  test("path: null still honors an explicit canonical", () => {
    const html = renderHead({ canonical: "/" }, { path: null, baseUrl: "https://x.com" });
    expect(html).toContain('<link rel="canonical" href="https://x.com/">');
  });

  test("makes image URLs absolute and picks summary_large_image when an image exists", () => {
    const html = renderHead(
      { title: "T", openGraph: { image: "/og.png" } },
      { path: "/", baseUrl: "https://x.com" },
    );
    expect(html).toContain('<meta property="og:image" content="https://x.com/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  test("renders robots object as a directive string", () => {
    const html = renderHead({ robots: { index: false, follow: true } }, {});
    expect(html).toContain('<meta name="robots" content="noindex, follow">');
  });

  test("emits JSON-LD and escapes a script breakout", () => {
    const html = renderHead({ jsonLd: { "@type": "Thing", n: "</script>" } }, {});
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toContain("</script><");
    expect(html).toContain("\\u003c/script>");
  });

  test("escapes attribute values", () => {
    const html = renderHead({ description: 'a "b" & c' }, {});
    expect(html).toContain('content="a &quot;b&quot; &amp; c"');
  });
});
