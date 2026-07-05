import fs from "node:fs";
import path from "node:path";

const ENV_DTS = `/** OTF Web compiler macros — provided at build time, not runtime. */
declare const $state: {
  <T>(initial: T): T;
  <T>(): T | undefined;
};
declare function $derived<T>(fn: () => T): T;
declare function $effect(fn: () => void | (() => void)): void;
`;

const TSCONFIG = {
  compilerOptions: {
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "preserve",
    jsxImportSource: "@opentf/web",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    isolatedModules: true,
    moduleDetection: "force",
  },
  include: ["app", "otfw.config.js"],
};

/** @param {string} dir */
function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, files);
    else files.push(full);
  }
  return files;
}

/** @param {string} file */
function shouldRenameToTsx(file) {
  return file.endsWith(".jsx");
}

/** @param {string} file */
function shouldRenameRouteToTs(file) {
  return path.basename(file) === "route.js" && file.includes(`${path.sep}api${path.sep}`);
}

/** @param {string} content @param {"bare" | "docs" | "library"} template */
function patchSource(content, template) {
  let next = content
    .replaceAll("app/page.jsx", "app/page.tsx")
    .replaceAll("app/api/hello/route.js", "app/api/hello/route.ts")
    .replaceAll("route.js", "route.ts");

  if (template === "library") {
    next = next
      .replaceAll("./src/Counter.jsx", "./src/Counter.tsx")
      .replaceAll("../src/Counter.jsx", "../src/Counter.tsx");
  } else {
    next = next.replaceAll(".jsx", ".tsx");
  }

  return next;
}

/** @param {string} content @param {string} basename */
function patchLayoutTypes(content, basename) {
  if (!basename.startsWith("layout.")) return content;
  if (/\{ children \}/.test(content)) {
    return content.replace(
      /export default function (\w+)\(\{ children \}\)/,
      "export default function $1({ children }: { children: unknown })",
    );
  }
  return content.replace(
    /export default function (\w+)\(props\)/,
    "export default function $1(props: { children: unknown })",
  );
}

/** @param {string} content @param {string} basename */
function patchComponentTypes(content, basename) {
  if (basename !== "Counter.tsx") return content;
  return content.replace(
    /export default function Counter\(\{ initial = 0 \}\)/,
    "export default function Counter({ initial = 0 }: { initial?: number })",
  );
}

/**
 * Convert a freshly scaffolded JS project to TypeScript (rename + tsconfig).
 *
 * @param {string} targetDir
 * @param {"bare" | "docs" | "library"} template
 * @param {Record<string, unknown>} [pkg]
 */
export function applyTypescript(targetDir, template, pkg) {
  const files = walkFiles(targetDir);

  for (const file of files) {
    let nextPath = file;
    if (shouldRenameToTsx(file)) nextPath = file.replace(/\.jsx$/, ".tsx");
    else if (shouldRenameRouteToTs(file)) nextPath = file.replace(/route\.js$/, "route.ts");

    if (nextPath !== file) {
      let content = fs.readFileSync(file, "utf-8");
      content = patchSource(content, template);
      content = patchLayoutTypes(content, path.basename(nextPath));
      content = patchComponentTypes(content, path.basename(nextPath));
      fs.writeFileSync(nextPath, content);
      fs.rmSync(file);
    }
  }

  const indexJs = path.join(targetDir, "index.js");
  if (template === "library" && fs.existsSync(indexJs)) {
    let content = fs.readFileSync(indexJs, "utf-8");
    content = patchSource(content, template);
    fs.writeFileSync(path.join(targetDir, "index.ts"), content);
    fs.rmSync(indexJs);
  }

  const envPath =
    template === "library"
      ? path.join(targetDir, "otfw-env.d.ts")
      : path.join(targetDir, "app", "otfw-env.d.ts");
  fs.writeFileSync(envPath, ENV_DTS);

  const tsconfig = {
    compilerOptions: { ...TSCONFIG.compilerOptions },
    include: [...TSCONFIG.include],
  };

  if (template === "bare") {
    tsconfig.include = ["app"];
    const { allowJs: _allowJs, ...rest } = tsconfig.compilerOptions;
    tsconfig.compilerOptions = rest;
  } else if (template === "library") {
    tsconfig.include = ["src", "tests", "index.ts", "otfw-env.d.ts"];
    const { allowJs: _allowJs, ...rest } = tsconfig.compilerOptions;
    tsconfig.compilerOptions = rest;
  }

  const jsconfigPath = path.join(targetDir, "jsconfig.json");
  if (fs.existsSync(jsconfigPath)) fs.rmSync(jsconfigPath);

  fs.writeFileSync(path.join(targetDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");

  if (template === "library") {
    const testJs = path.join(targetDir, "tests/counter.test.js");
    if (fs.existsSync(testJs)) {
      let content = fs.readFileSync(testJs, "utf-8");
      content = content.replace("../src/Counter.jsx", "../src/Counter.tsx");
      fs.writeFileSync(testJs, content);
    }
    if (pkg) {
      pkg.exports = { ".": "./index.ts" };
      pkg.files = ["index.ts", "src"];
    }
  }
}