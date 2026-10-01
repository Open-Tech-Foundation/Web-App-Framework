import { afterAll, expect, test } from "runtime:test";
import { dirname, fromFileURL, join } from "runtime:path";
import { Command } from "runtime:system";
import { closeCompilers, createWebPlugin, startCompilerServer } from "../index.js";

afterAll(closeCompilers);

// Decode mappings independently of the compiler's encoder. The integration
// suite also exercises esdev's own consumer against a final bundled map.
function mappings(map) {
  let source = 0, originalLine = 0, originalColumn = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const result = [];
  for (const [line, encoded] of map.mappings.split(";").entries()) {
    let column = 0;
    for (const segment of encoded.split(",").filter(Boolean)) {
      const fields = [];
      let bits = 0, shift = 0;
      for (const char of segment) {
        const digit = alphabet.indexOf(char);
        if (digit < 0) throw new Error("Invalid source-map digit");
        bits += (digit & 31) * 2 ** shift;
        if (digit & 32) { shift += 5; continue; }
        fields.push((bits & 1 ? -1 : 1) * Math.floor(bits / 2));
        bits = 0; shift = 0;
      }
      column += fields[0];
      if (fields.length === 1) { result.push({ line, column, source: null }); continue; }
      source += fields[1]; originalLine += fields[2]; originalColumn += fields[3];
      result.push({ line, column, source, originalLine, originalColumn });
    }
  }
  return result;
}

function originalAt(result, needle) {
  const offset = result.code.indexOf(needle);
  expect(offset >= 0).toBe(true);
  const prefix = result.code.slice(0, offset);
  const line = prefix.split("\n").length - 1;
  const column = prefix.slice(prefix.lastIndexOf("\n") + 1).length;
  return mappings(result.map).filter(item => item.line === line && item.column <= column).at(-1);
}

const source = `export default function Home() {
  let value = $state("🔥");
  let doubled = $derived(value + value);
  const explode = () => {
    throw new Error("source-map-probe");
  };
  return <button onclick={() => explode()}>{doubled}</button>;
}`;

for (const target of ["csr", "ssg", "hydrate"]) {
  test(`${target} maps handlers, state reads, and multiline statements to original JSX`, async () => {
    const result = await createWebPlugin({ target }).transform.handler(source, "/app/page.jsx", { type: "jsx" });
    expect(result.map.version).toBe(3);
    expect(result.map.sources).toEqual(["/app/page.jsx"]);
    expect(result.map.sourcesContent).toEqual([source]);
    expect(result.code.includes("/*#__OTFW_MAP_")).toBe(false);
    const error = originalAt(result, 'throw new Error("source-map-probe")');
    expect(error.source).toBe(0);
    expect(error.originalLine).toBe(4);
    expect(error.originalColumn).toBe(4);
    const state = originalAt(result, 'value.value + value.value');
    expect(state.originalLine).toBe(2);
    expect(state.originalColumn).toBe(25);
    // `.value` is compiler-owned; it must not inherit a source location.
    expect(originalAt(result, '.value + value.value').source).toBeNull();
  });
}

test("UTF-16 columns remain correct after astral Unicode on the same source line", async () => {
  const source = 'export default function Home() { const text = "🔥"; throw new Error("unicode"); return <p>{text}</p>; }';
  const result = await createWebPlugin().transform.handler(source, "/app/page.tsx", { type: "tsx" });
  const original = originalAt(result, 'throw new Error("unicode")');
  expect(original.originalLine).toBe(0);
  expect(original.originalColumn).toBe(source.indexOf("throw"));
});

test("Markdown source maps identify the generated JSX intermediate", async () => {
  const result = await createWebPlugin().transform.handler("# Hello\n", "/app/page.mdx", { type: "mdx" });
  expect(result.map.sources).toEqual(["/app/page.mdx?otfw-jsx"]);
  expect(result.map.sourcesContent[0]).toContain("export default");
});

test("CLI --sourcemap emits an inline map and the legacy service still returns JavaScript", async () => {
  const root = dirname(dirname(dirname(dirname(fromFileURL(import.meta.url)))));
  const compiler = join(root, "target/debug/otfwc");
  const output = await new Command(compiler, {
    args: ["build", "--stdin", "--sourcemap", "/app/page.jsx"], stdin: source,
  }).output();
  expect(output.success).toBe(true);
  const code = new TextDecoder().decode(output.stdout);
  expect(code).toContain("//# sourceMappingURL=data:application/json;charset=utf-8;base64,");
  const encoded = code.split("base64,")[1].trim();
  const map = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))));
  expect(map.sourcesContent).toEqual([source]);
  const service = startCompilerServer(compiler);
  const legacy = await service.compile("/app/page.jsx", source, false);
  expect(typeof legacy).toBe("string");
  expect(legacy).not.toContain("sourceMappingURL");
});
