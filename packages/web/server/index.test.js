import { expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { env } from "runtime:process";
import { Command } from "runtime:system";

const web = dirname(dirname(fromFileURL(import.meta.url)));
const root = dirname(dirname(web));

// A fresh runtime proves that a sibling suite's HTMLElement shim cannot hide
// browser dependencies. Resolve the package's actual published server export.
async function runServer(source) {
  await mkdir(join(root, ".cache"), { recursive: true });
  const dir = await makeTempDir({ dir: join(root, ".cache"), prefix: "server-entry-" });
  try {
    await mkdir(join(dir, "node_modules/@opentf"), { recursive: true });
    async function copyPackage(source, target) {
      if ((await stat(source)).isDir) {
        await mkdir(target, { recursive: true });
        for (const entry of await readDir(source)) {
          if (!entry.name.endsWith(".test.js")) await copyPackage(join(source, entry.name), join(target, entry.name));
        }
      } else {
        await mkdir(dirname(target), { recursive: true });
        await copy(source, target);
      }
    }
    const manifest = await file(join(web, "package.json")).json();
    for (const path of ["package.json", ...manifest.files.filter(path => !path.startsWith("!"))]) {
      await copyPackage(join(web, path), join(dir, "node_modules/@opentf/web", path));
    }
    await write(join(dir, "package.json"), '{"type":"module"}');
    await write(join(dir, "probe.js"), `
const assert = (value, label) => { if (!value) throw Error(label); };
const noDOM = () => assert(typeof HTMLElement === "undefined" && typeof window === "undefined" && typeof document === "undefined" && typeof customElements === "undefined", "Server must not install DOM globals");
noDOM();
const server = await import("@opentf/web/server");
noDOM();
${source}
noDOM();
console.log("PASS DOM-free server entry");
`);
    const result = await new Command(env.ESDEV_BIN || "esdev", {
      args: ["probe.js"], cwd: dir, inheritEnv: true, timeout: 20000,
    }).output();
    if (!result.success) throw Error(new TextDecoder().decode(result.stderr));
    expect(new TextDecoder().decode(result.stdout)).toContain("PASS DOM-free server entry");
  } finally { await remove(dir, { recursive: true }); }
}

test("public server entry registers lazy routes, metadata, static paths, locales and 404s without a DOM", async () => {
  await runServer(`
const { registerRoutes, configureI18n, i18nLocales, resolveLocale, localizePath, matchRoute, renderRoute, collectRoutePaths, renderHead } = server;
configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
registerRoutes({
  "/app/layout.jsx": async () => ({ default: ({ children }) => '<main>' + children + '</main>', metadata: { titleTemplate: "%s — Site" } }),
  "/app/post/[id]/page.jsx": async () => ({
    default: ({ params }) => '<h1>' + params.id + '</h1>',
    generateMetadata: ({ params }) => ({ title: params.id }),
    getStaticPaths: () => [{ params: { id: "hello world" } }],
  }),
  "/app/404.jsx": { default: () => "Missing" },
});
assert(i18nLocales().defaultLocale === "en", "locale config");
assert(resolveLocale("/fr/post/one").path === "/post/one", "locale resolution");
assert(localizePath("/post/one", "fr") === "/fr/post/one", "localized URL");
assert(matchRoute("/fr/post/hello%20world").params.id === "hello world", "decoded match");
const rendered = await renderRoute("/fr/post/hello%20world");
assert(rendered.html === "<main><h1>hello world</h1></main>", "lazy page and layout render");
assert(renderHead(rendered.metadata).includes("hello world — Site"), "metadata uses same route table");
assert((await collectRoutePaths()).paths[0].path === "/post/hello%20world", "static path export");
assert((await renderRoute("/missing")).status === 404, "fallback registration");
`);
});

test("public server router shares isolated request state across concurrent SSR renders", async () => {
  await runServer(`
const { registerRoutes, configureI18n, router, renderRoute } = server;
configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
registerRoutes({ "/app/post/[id]/page.jsx": {
  default: () => JSON.stringify({ id: router.params.id, query: router.query.q, locale: router.locale, data: router.data }),
  async generateMetadata() {
    const id = router.params.id;
    await new Promise(resolve => setTimeout(resolve, id === "A" ? 10 : 1));
    return { title: [router.params.id, router.query.q, router.locale, router.data.token].join(":") };
  },
} });
const [a, b] = await Promise.all([
  renderRoute("/fr/post/A", null, "?q=first", { data: { token: "alpha" } }),
  renderRoute("/post/B", null, "?q=second", { data: { token: "beta" } }),
]);
assert(a.metadata.title === "A:first:fr:alpha", "request A metadata");
assert(b.metadata.title === "B:second:en:beta", "request B metadata");
assert(JSON.parse(a.html).data.token === "alpha", "request A loader data");
assert(JSON.parse(b.html).locale === "en", "request B locale");
`);
});

test("server context, lifecycle and built-in renderers need no DOM globals", async () => {
  await runServer(`
const { createContext, readContext, onMount, Link, Portal, RawHtml, ssgComponent, registerRoutes, renderRoute, configureI18n } = server;
const theme = createContext("dark");
assert(readContext(theme).value === "dark", "context fallback");
let ran = false; onMount(() => { ran = true; }); assert(!ran, "server lifecycle is inert");
assert(Link.tag === "web-link" && Portal.tag === "web-internal-portal", "renderer tags");
assert(RawHtml({ html: "<b>raw</b>" }) === "<b>raw</b>", "raw HTML renderer");
configureI18n({ locales: ["en", "fr"], defaultLocale: "en" });
registerRoutes({ "/app/link/page.jsx": { default: () => ssgComponent("web-link", { href: "/next?q=a&b", class: { active: true }, "aria-label": 'Read "next"', ariaCurrent: "page" }, "<b>Next</b>") } });
const { html } = await renderRoute("/fr/link");
assert(html.includes('href="/fr/next?q=a&amp;b"'), "localized escaped href");
assert(html.includes('class="active"') && html.includes('aria-current="page"'), "link attributes");
assert(html.includes('aria-label="Read &quot;next&quot;"'), "ARIA escaping");
assert(html.includes('<!--c[web-link--><b>Next</b><!--c]web-link-->'), "hydration slot markers");
`);
});
