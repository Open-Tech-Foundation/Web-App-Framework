import * as babel from "@babel/core";
import plugin from "../framework/compiler/babel-plugin.cjs";

const code = `
export function MyComp() {
  return <div>Hello</div>;
}
`;

try {
  const result = babel.transform(code, {
    plugins: [
      "@babel/plugin-syntax-jsx",
      [plugin]
    ],
    filename: "test.jsx",
    configFile: false,
    babelrc: false
  });
  console.log(result.code);
} catch (e) {
  console.error(e);
}
