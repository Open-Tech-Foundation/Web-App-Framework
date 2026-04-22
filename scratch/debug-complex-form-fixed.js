import * as babel from "@babel/core";
import plugin from "../framework/compiler/babel-plugin.cjs";

const code = `
import { mapped } from "/framework/runtime/dom.js";

export function ComplexForm() {
  const form = createForm({ initialValues: { skills: ["JS"] } });
  const skillsRenderer = mapped(form.array('skills'), (skill, index) => (
    <input 
      value={form.fields[\`skills.\${index}\`]}
      oninput={(e) => form.fields[\`skills.\${index}\`].value = e.target.value}
    />
  ));
  
  return (
    <div>
      {skillsRenderer}
    </div>
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
