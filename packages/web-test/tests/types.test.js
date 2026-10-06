import { expect, test } from "runtime:test";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { dirname, fromFileURL, join } from "runtime:path";
import { Command } from "runtime:system";

test("published declarations type a strict TypeScript component test", async () => {
  const pkg = dirname(dirname(fromFileURL(import.meta.url)));
  const packages = dirname(pkg);
  // Inside the package so `@testing-library/*` resolve from its own node_modules.
  await mkdir(join(pkg, ".cache"), { recursive: true });
  const scratch = await makeTempDir({ dir: join(pkg, ".cache"), prefix: "types-" });
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
    for (const name of ["web", "web-test"]) {
      const source = join(packages, name);
      const target = join(scratch, "node_modules/@opentf", name);
      const manifest = JSON.parse(await file(join(source, "package.json")).text());
      for (const path of ["package.json", ...manifest.files.filter((path) => !path.startsWith("!"))]) {
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
    await write(join(scratch, "counter.test.tsx"), `
      import "@opentf/web-test/setup";
      import { cleanup, render, userEvent, type RenderResult } from "@opentf/web-test";
      function Counter({ initial = 0 }: { initial?: number }) {
        return <button>Count {initial}</button>;
      }
      async function run() {
        const view: RenderResult = render(Counter, { initial: 3 });
        const button: HTMLElement = view.getByRole("button", { name: "Count 3" });
        const missing: HTMLElement | null = view.queryByText("nothing");
        const container: HTMLElement = view.container;
        await userEvent.setup().click(button);
        view.unmount();
        render("x-widget");
        cleanup();
        // @ts-expect-error props are checked against the component
        render(Counter, { initial: "three" });
        // @ts-expect-error unknown queries are rejected
        view.getByNothing("x");
        return { missing, container };
      }
      run();
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
