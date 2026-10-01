# @opentf/esdev-plugin-web

OTF Web plugins for esdev's `runtime:build` bundler — compile `.jsx`/`.tsx`
(and `.mdx`/`.md` sources that lower to JSX) through the `otfwc` IR compiler.
Everything here runs on `esdev` (`runtime:*` only), which is what lets a
framework dev server stop being a Node program.

## esdev create integration

Requires esdev 0.14 or newer. A native OTF starter uses the package's default
factory in the top-level `plugins` array; no `export` name or custom CLI is needed:

```json
{
  "plugins": ["@opentf/esdev-plugin-web"],
  "build": {
    "targets": {
      "web": { "entry": "index.html", "outdir": "dist" }
    }
  }
}
```

The starter must install `@opentf/web` and `@opentf/esdev-plugin-web`. Its
`index.html` includes `<script type="module" src="./entry.js"></script>` and an
`#app` element. `entry.js` mounts the file-convention routes:

```js
import { mountApp } from "@opentf/web";
import { pages, guard } from "@otfw/routes";

mountApp({ pages, guard, target: document.getElementById("app") });
```

Run `esdev start`, `esdev build`, or `esdev test --dom`. CSS and Tailwind use
esdev's native pipeline. This package adds compilation and route discovery;
it does not generate HTML entries, server handlers, or prerender scripts.

For SSG/SSR, configure the default factory with options:

```json
{
  "plugins": [{
    "module": "@opentf/esdev-plugin-web",
    "options": { "mode": "ssr", "appDir": "app" }
  }],
  "build": {
    "targets": {
      "web": { "entry": "index.html", "outdir": "dist" },
      "server": { "entry": "server.js", "out": "dist/server.js" }
    }
  }
}
```

`mode` accepts `spa` (default), `ssg`, or `ssr`. The compiler reads
`ctx.command` and `ctx.platform` for each module:

| Context | SPA | SSG / SSR |
| --- | --- | --- |
| Server build, start, or script | `ssg` | `ssg` |
| Browser release build | `csr` | `hydrate` |
| Browser development or DOM test | `csr` | `csr` |

An explicit `target` (`csr`, `ssg`, or `hydrate`) overrides that selection.
`routes: false` disables route discovery for library builds. `exclude` filters
route subtrees. Compiler errors fail by default; `failOnError: false` opts into
browser diagnostic stubs.

The default export is also available as `createWebPlugin`. Separate named
compiler and route factories remain available for custom pipelines. A prior
transform that reports `type: "js"` for a JSX/TSX file is left alone.

See the official [project configuration](https://esrun.opentechf.org/esdev/build/project),
[plugin context](https://esrun.opentechf.org/esdev/plugins/context), and
[plugin lifecycle](https://esrun.opentechf.org/esdev/plugins/lifecycle).
`esdev create` templates are embedded in esdev: updating this package does not
change the templates in an already installed esdev binary. Their generated
configuration must reference this plugin and their scripts must use esdev.

## Programmatic use

Programmatic (any `runtime:build` driver):

```js
import { build } from "runtime:build";
import { closeCompilers, otfwPlugin, resolveCompiler } from "@opentf/esdev-plugin-web";

// Locate the compiler: OTFWC_BIN, then the @opentf/web-compiler prebuilt,
// then a local Cargo workspace checkout (built on demand).
const { otfwc } = await resolveCompiler();

const bundle = await build({
  input: "app/page.jsx",
  plugins: [otfwPlugin(otfwc, { target: "csr" })],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
await closeCompilers(); // one-shot commands: release the `otfwc serve` child
```

`otfwPlugin(otfwc, { target, failOnError, onResult, quiet })`:

- `target` picks the codegen backend: `"csr"` (live DOM build), `"ssg"`
  (HTML-string renderers), or `"hydrate"` (dual module — CSR factory plus a
  first-paint adopt factory). Page / layout / 404 modules become factories;
  everything else a Custom Element.
- Without `failOnError`, a compile error emits a diagnostic stub so one bad
  route doesn't sink the build; with it, the build fails carrying the
  diagnostic. `onResult(id, diagnosticOrNull)` reports per module (an error
  overlay clears entries as files are fixed); `quiet()` takes back a live
  progress line before the diagnostic prints.

Compilation runs through one persistent `otfwc serve` child per plugin
instance — the binary starts once no matter how many modules or builds follow.

## API

- `createOtfwPlugin({ target, mode, failOnError, onResult, quiet })` — the
  `esdev.json` project-plugin factory:

  ```json
  { "plugins": [{ "module": "@opentf/esdev-plugin-web",
                  "export": "createOtfwPlugin",
                  "options": { "target": "csr" } }] }
  ```

  Synchronous by design (the compiler resolves lazily on the first
  transformed module). Declare it in the top-level `plugins` array of
  `esdev.json`, alongside `build.targets` and `dev`. In esdev 0.14 or newer,
  `resolve`, `load`, and `transform` also run for `esdev test`, `esdev test --dom`,
  and `esdev <file>`, so JSX imports compile directly without prebundling.
  Use `--config=esdev.test.json` with `target: "csr"` and `failOnError: true`
  when tests need a different rendering mode from the app's build.
  See the official [plugin configuration](https://esrun.opentechf.org/esdev/build/project#where-plugins-run).

- `createOtfwRoutes({ appDir, exclude })` — the Next.js-style file
  conventions as a plugin: serves a virtual `@otfw/routes` module
  (`{ pages, guard }`) crawled from `app/` with the runtime's `Glob`
  (`**/{page,layout,404}.{mdx,md,jsx,tsx}`). A user entry stays four lines:

  ```js
  import { mountApp } from "@opentf/web";
  import { guard, pages } from "@otfw/routes";

  mountApp({ pages, guard, target: document.getElementById("app") });
  ```

  `resolve` + `load` only. It runs under builds and unbundled commands alike
  when configured; tests that hand-write a route map can omit it.

- `resolveCompiler({ cliDir, env, resolvePackagedCompiler, findWorkspace, ensure })`
  — every input injectable, so tests never touch the disk or the network.
- `startCompilerServer(otfwc)` → `{ compile(id, source, component, target), close }`
- `closeCompilers()` — stop every child started in this process.
- `compileError(payload)` — an `ERR` reply payload as an `Error` with the
  compiler's structured diagnostic (`.diag`, `.text`).
