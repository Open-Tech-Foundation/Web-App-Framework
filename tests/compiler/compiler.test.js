import { expect, test, describe } from "bun:test";
import { transformSync } from "@babel/core";
import plugin from "../../framework/compiler/babel-plugin.cjs";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const CASES_DIR = join(import.meta.dir, "cases");

describe("WAF Compiler", () => {
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

      expect(result.code).toMatchSnapshot();
    });
  });
});
