import { expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { Command } from "runtime:system";

test("published framework types support strict TS starters and reject invalid JSX", async () => {
  const packageDir = dirname(dirname(fromFileURL(import.meta.url)));
  await mkdir(".cache", { recursive: true });
  const scratch = await makeTempDir({ dir: ".cache", prefix: "jsx-types-" });
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
    const manifest = JSON.parse(await file(join(packageDir, "package.json")).text());
    const installed = join(scratch, "node_modules/@opentf/web");
    await copyPath(join(packageDir, "package.json"), join(installed, "package.json"));
    for (const path of manifest.files.filter((path) => !path.startsWith("!"))) {
      await copyPath(join(packageDir, path), join(installed, path));
    }
    await write(join(scratch, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, isolatedModules: true, moduleDetection: "force",
        module: "ESNext", moduleResolution: "bundler", jsx: "preserve",
        jsxImportSource: "@opentf/web", lib: ["ESNext", "DOM", "DOM.Iterable"],
        skipLibCheck: false, types: [],
      }, include: ["*.tsx"],
    }));
    await write(join(scratch, "pages.tsx"), `
      import { router, signal, computed, Link, mountApp, onMount, onResize, onMediaQuery, resource, Portal, RawHtml, ErrorBoundary, ContextProvider, createContext } from "@opentf/web";
      import { registerRoutes } from "@opentf/web/server";
      declare function $state<T>(value: T): T;
      export function Counter({ initial = 0 }: { initial?: number }) {
        let count = $state(initial);
        return <button onclick={event => { event.currentTarget.disabled = true; count++; }}>{count}</button>;
      }
      export function Layout({ children }: { children: unknown }) { return <main>{children}</main>; }
      export function Home() {
        return <Layout><h1>{router.data?.message}</h1><Counter initial={1}/>
          <input onInput={event => { event.currentTarget.value = "ok"; }} />
          <Portal to="body"><p>Portaled</p></Portal>
          <RawHtml html="<b>HTML</b>"/><ErrorBoundary fallback={() => <p>Failed</p>}><p>Safe</p></ErrorBoundary>
          <ContextProvider context={createContext("light")} value="dark"><p>Theme</p></ContextProvider>
          <Link href="/docs">Docs</Link><web-card data-kind="example" aria-hidden={false}/>
          <svg viewBox="0 0 10 10"><circle cx={5} cy={5} r={3}/></svg>
        </Layout>;
      }
      const value = signal(1); const doubled: number = computed(() => value.value * 2).value;
      onMount(() => () => {}); onResize(entry => { const width: number = entry.contentRect.width; });
      onMediaQuery("(prefers-reduced-motion)", matches => { const reduced: boolean = matches; });
      const asyncValue = resource(async () => 42); const result: number | undefined = asyncValue.data;
      const ref = signal<HTMLHeadingElement | null>(null);
      const heading = <h1 ref={ref} class={{ active: true }}>Hello</h1>;
      registerRoutes({}); mountApp({ pages: {}, loaders: ["/"], i18n: { locales: ["en"], defaultLocale: "en" } });
      // @ts-expect-error native event targets retain their type
      const badEvent = <button onclick={event => event.currentTarget.noSuchProperty}/>;
      // @ts-expect-error boolean attribute does not accept an object
      const badAttr = <button disabled={{}}/>;
      // @ts-expect-error typed component props are checked
      const badProp = <Counter initial="one"/>;
      // @ts-expect-error signal writes retain their value type
      value.value = "one";
    `);
    const checked = await new Command("pnpm", {
      args: ["exec", "tsc", "-p", join(scratch, "tsconfig.json")], inheritEnv: true,
    }).output();
    const output = new TextDecoder().decode(checked.stdout) + new TextDecoder().decode(checked.stderr);
    if (!checked.success) throw new Error(output);
    expect(checked.success).toBe(true);
  } finally {
    await remove(scratch, { recursive: true });
  }
});
