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

/** @param {string} content */
function patchSource(content) {
  return content
    .replaceAll("app/page.jsx", "app/page.tsx")
    .replaceAll("app/api/hello/route.js", "app/api/hello/route.ts")
    .replaceAll("route.js", "route.ts")
    .replaceAll(".jsx", ".tsx");
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

/**
 * Convert a freshly scaffolded JS project to TypeScript (rename + tsconfig).
 *
 * @param {string} targetDir
 * @param {"bare" | "docs"} template
 */
export function applyTypescript(targetDir, template) {
  const files = walkFiles(targetDir);

  for (const file of files) {
    let nextPath = file;
    if (shouldRenameToTsx(file)) nextPath = file.replace(/\.jsx$/, ".tsx");
    else if (shouldRenameRouteToTs(file)) nextPath = file.replace(/route\.js$/, "route.ts");

    if (nextPath !== file) {
      let content = fs.readFileSync(file, "utf-8");
      content = patchSource(content);
      content = patchLayoutTypes(content, path.basename(nextPath));
      fs.writeFileSync(nextPath, content);
      fs.rmSync(file);
    }
  }

  const envPath = path.join(targetDir, "app", "otfw-env.d.ts");
  fs.writeFileSync(envPath, ENV_DTS);

  const tsconfig = {
    compilerOptions: { ...TSCONFIG.compilerOptions },
    include: [...TSCONFIG.include],
  };
  if (template === "bare") {
    tsconfig.include = ["app"];
    const { allowJs: _allowJs, ...rest } = tsconfig.compilerOptions;
    tsconfig.compilerOptions = rest;
  }

  fs.writeFileSync(path.join(targetDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
}