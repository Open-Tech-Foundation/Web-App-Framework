import { renderDynamic as _renderDynamic, mapped as _mapped } from "/framework/runtime/dom.js";
export function render(root, props) {
  const rootElement = (() => {
    const el0 = document.createElement("div");
    const el1 = document.createElement("h1");
    el1.className = "text-2xl font-bold";
    const text2 = document.createTextNode("Shop");
    el1.appendChild(text2);
    el0.appendChild(el1);
    const el3 = document.createElement("p");
    el3.className = "mt-4";
    const text4 = document.createTextNode("Slug segments: ");
    el3.appendChild(text4);
    el0.appendChild(el3);
    const el5 = document.createElement("ul");
    el5.className = "list-disc ml-6 mt-2";
    const mapped6 = _mapped(() => props.params.slug, segment => (() => {
      const el0 = document.createElement("li");
      _renderDynamic(el0, () => segment);
      return el0;
    })());
    _renderDynamic(el5, () => mapped6);
    el0.appendChild(el5);
    const el7 = document.createElement("div");
    el7.className = "mt-4 p-4 bg-slate-800 rounded";
    const text8 = document.createTextNode("Full path: ");
    el7.appendChild(text8);
    const el9 = document.createElement("span");
    el9.className = "text-indigo-400 font-mono";
    const text10 = document.createTextNode("/shop/");
    el9.appendChild(text10);
    _renderDynamic(el9, () => props.params.slug.join('/'));
    el7.appendChild(el9);
    el0.appendChild(el7);
    return el0;
  })();
  root.appendChild(rootElement);
}