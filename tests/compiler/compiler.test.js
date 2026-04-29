import { expect, test, describe } from "bun:test";
import { transformSync } from "@babel/core";
import plugin from "../../packages/web/compiler/index.js";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";

const CASES_DIR = join(import.meta.dir, "cases");
const OUTPUT_DIR = join(import.meta.dir, "output");

// Ensure output directory exists
mkdirSync(OUTPUT_DIR, { recursive: true });

describe("Web App Framework Compiler", () => {
  const files = readdirSync(CASES_DIR);

  files.forEach((file) => {
    test(`Compiles ${file}`, () => {
      const filePath = join(CASES_DIR, file);
      const code = readFileSync(filePath, "utf8");

      const result = transformSync(code, {
        filename: file,
        plugins: [
          "@babel/plugin-syntax-jsx",
          [plugin]
        ],
        configFile: false,
      });

      // Save to individual output file for easier review
      const outputFilename = basename(file, extname(file)) + ".compiled.js";
      writeFileSync(join(OUTPUT_DIR, outputFilename), result.code);

      expect(result.code).toMatchSnapshot();
    });
  });
});
