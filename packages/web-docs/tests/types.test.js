import { expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { Command } from "runtime:system";

test("published docs types support strict starters, virtual entries and checked component props", async () => {
  const packages = dirname(dirname(dirname(fromFileURL(import.meta.url))));
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "docs-types-" });
  async function copyPath(source, target) {
    if ((await stat(source)).isDir) {
      await mkdir(target, { recursive: true });
      for (const entry of await readDir(source)) await copyPath(join(source, entry.name), join(target, entry.name));
    } else {
      await mkdir(dirname(target), { recursive: true });
      await copy(source, target);
    }
  }
  try {
    // Exercise only the published files and exports, without workspace aliases.
    for (const name of ["web", "web-docs"]) {
      const source = join(packages, name);
      const target = join(scratch, "node_modules/@opentf", name);
      const manifest = JSON.parse(await file(join(source, "package.json")).text());
      for (const path of ["package.json", ...manifest.files.filter(path => !path.startsWith("!"))]) {
        await copyPath(join(source, path), join(target, path));
      }
    }
    await write(join(scratch, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, isolatedModules: true, moduleDetection: "force",
        module: "ESNext", moduleResolution: "bundler", jsx: "preserve",
        jsxImportSource: "@opentf/web", lib: ["ESNext", "DOM", "DOM.Iterable"],
        skipLibCheck: false, types: [],
      }, include: ["*.tsx"],
    }));
    await write(join(scratch, "starter.tsx"), `
      import { Navbar, Footer, DocsLayout, BlogLayout, PostList } from "@opentf/web-docs";
      import defineDocsConfig, { type DocsFooter, type ProxyConfig } from "@opentf/web-docs/config";
      import nav from "@opentf/web-docs/nav";
      import posts, { posts as namedPosts } from "@opentf/web-docs/posts";
      import updated, { editPaths } from "@opentf/web-docs/updated";
      const config = defineDocsConfig({ site: {url: "https://example.com"}, docs: {
        title: "Docs", nav: [{label: "Docs", href: "/docs"}], search: {provider: "otf"},
        footer: {text: "Footer"}, lastUpdated: true,
      }, blog: {dir: "blog"} });
      const title: string = config.docs.title;
      const footer: DocsFooter = config.docs.footer;
      const proxy: ProxyConfig = {"/api": {target: "http://localhost:8080"}};
      export function Root({children}: {children: unknown}) {
        return <div><Navbar config={config.docs}/>{children}<Footer config={config.docs}/></div>;
      }
      export function Docs({children}: {children: unknown}) {
        return <DocsLayout config={config.docs} nav={nav} frame={false}>{children}</DocsLayout>;
      }
      export function Blog({children}: {children: unknown}) {
        return <BlogLayout config={config.docs} posts={posts} frame={false}>{children}</BlogLayout>;
      }
      export function Index() { return <PostList posts={namedPosts}/>; }
      const timestamp: string | undefined = updated["/docs"];
      const source: string | undefined = editPaths["/docs"];
      const minutes: number | undefined = posts[0]?.readingTime;
      const items = nav["/docs"]?.[0]?.items;
    `);
    await write(join(scratch, "authoring.tsx"), `
      import {
        Callout, Card, Cards, Tabs, Steps, Table, CodeBlock, Tooltip, LastUpdated,
        NavbarLink, Sidebar, SidebarToggle, NavIcon, Toc, ThemeToggle, Search,
        SearchTrigger, Breadcrumbs, Pagination, ReadingTime, PostCard, PostBanner,
        PostMeta, createSearch as rootSearch, type BlogPost, type DocsNavItem,
      } from "@opentf/web-docs";
      import { defineDocsConfig } from "@opentf/web-docs/config";
      import { createSearch, tokenize, excerptParts, type SearchResult } from "@opentf/web-docs/search";
      const post: BlogPost = {slug: "hello", path: "/blog/hello", title: "Hello", readingTime: 2};
      const nav: DocsNavItem[] = [{title: "Group", items: [{title: "Intro", path: "/docs"}]}];
      const content = <Cards><Card href="/docs" title="Docs" desc="Read"/>
        <Callout type="tip" title="Tip"><b>Content</b></Callout>
        <Tabs tabs={[{label: "Example", content: <CodeBlock code="hello" lang="js" name="test.js"/>}]}/>
        <Steps><p>Step</p></Steps><Table><tbody><tr><td>Cell</td></tr></tbody></Table>
        <Tooltip text="Help" placement="top"><button>Help</button></Tooltip>
        <LastUpdated date={undefined}/><LastUpdated date={new Date()}/>
        <NavbarLink link={{label: "Docs", href: "/docs", external: false}}/>
        <Sidebar nav={nav}/><SidebarToggle/><NavIcon name="book"/><Toc/><ThemeToggle/>
        <Search/><SearchTrigger/><Breadcrumbs nav={nav}/><Pagination nav={nav}/>
        <ReadingTime minutes={2}/><PostCard post={post}/><PostBanner post={post}/>
        <PostMeta author="Author" date="2026-10-03"/><PostBanner title="Title"/>
      </Cards>;
      async function query() {
        const client = createSearch({base: "/_search/"}); await client.preload();
        const response = await client.query("state", {limit: 5, maxSectionsPerPage: 2, signal: new AbortController().signal});
        const results: SearchResult[] = response.results;
        const total: number = response.total;
        const partial: boolean = response.partial;
        results.forEach(result => { const section: string = result.section; excerptParts(result.excerpt, result.highlights); });
        tokenize("state").map(term => term.toUpperCase()); rootSearch();
      }
      // @ts-expect-error required link target is checked
      const badCard = <Card title="Missing href"/>;
      // @ts-expect-error component content is typed
      const badCode = <CodeBlock code={42}/>;
      // @ts-expect-error layout flags are booleans
      const badLayout = <Sidebar nav="docs"/>;
      // @ts-expect-error navigation links need href
      defineDocsConfig({docs: {nav: [{label: "Docs"}]}});
      // @ts-expect-error option values are numbers
      createSearch().query("state", {limit: "five"});
      // @ts-expect-error generated post record fields are typed
      const badPost: BlogPost = {...post, readingTime: "two"};
    `);
    const result = await new Command("pnpm", {
      args: ["exec", "tsc", "-p", join(scratch, "tsconfig.json")], inheritEnv: true,
    }).output();
    if (!result.success) throw new Error(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr));
    expect(result.success).toBe(true);
  } finally {
    await remove(scratch, { recursive: true });
  }
});
