import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
export function render(root) {
  const name = "WAF";
  const rootElement = (() => {
    const el0 = document.createElement("div");
    const el1 = document.createElement("span");
    const text2 = document.createTextNode("Hello ");
    el1.appendChild(text2);
    _renderDynamic(el1, () => name);
    const text3 = document.createTextNode("!");
    el1.appendChild(text3);
    el0.appendChild(el1);
    const el4 = document.createElement("p");
    const text5 = document.createTextNode("Line 1Line 2");
    el4.appendChild(text5);
    el0.appendChild(el4);
    const el6 = document.createElement("div");
    const text7 = document.createTextNode("Spaces should be preserved here -> ");
    el6.appendChild(text7);
    el0.appendChild(el6);
    return el0;
  })();
  root.appendChild(rootElement);
}