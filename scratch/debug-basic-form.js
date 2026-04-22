import * as babel from "@babel/core";
import plugin from "../framework/compiler/babel-plugin.cjs";

const code = `
export function BasicForm() {
  const form = createForm({ initialValues: { username: "" } });
  return (
    <form>
      <FormField label="User" {...form.register("username")} />
    </form>
  );
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
