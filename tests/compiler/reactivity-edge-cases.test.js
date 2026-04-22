import { expect, test, describe } from "bun:test";
import * as babel from "@babel/core";
import plugin from "../../framework/compiler/babel-plugin.cjs";

function compile(code) {
  return babel.transform(code, {
    plugins: ["@babel/plugin-syntax-jsx", [plugin]],
    filename: "test.jsx",
    configFile: false,
    babelrc: false,
  }).code;
}

describe("MWAF Compiler > Reactivity Edge Cases", () => {
  test("Handles nested .map() calls", () => {
    const code = `
      export function NestedList() {
        const categories = signal([{ id: 1, name: "Food", items: ["Apple", "Bread"] }]);
        return (
          <div>
            {categories.value.map(cat => (
              <div key={cat.id}>
                <h3>{cat.name}</h3>
                <ul>
                  {cat.items.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        );
      }
    `;
    const output = compile(code);
    expect(output).toContain("_mapped(() => cat.items");
    expect(output).toContain("_mapped(() => categories.value");
  });

  test("Handles .map() inside a conditional", () => {
    const code = `
      export function ConditionalList() {
        const show = signal(true);
        const items = signal([1, 2, 3]);
        return (
          <div>
            {show.value && items.value.map(i => <span key={i}>{i}</span>)}
          </div>
        );
      }
    `;
    const output = compile(code);
    // The .map() should still be optimized even if it's part of a logical expression
    expect(output).toContain("_mapped");
  });

  test("Maintains reactivity of attributes inside .map()", () => {
    const code = `
      export function DynamicItem() {
        const items = signal([{ id: 1, active: true }]);
        return (
          <div>
            {items.value.map(item => (
              <div className={item.active ? "active" : "inactive"}>
                {item.id}
              </div>
            ))}
          </div>
        );
      }
    `;
    const output = compile(code);
    // The className should be wrapped in an effect inside the mapped function
    expect(output).toContain("_effect(() => el0.className = item.active ? \"active\" : \"inactive\")");
  });
});
