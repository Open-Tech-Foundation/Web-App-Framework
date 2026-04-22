import { renderDynamic as _renderDynamic, mapped as _mapped } from "/framework/runtime/dom.js";
import { signal as _signal, effect as _effect } from "@preact/signals-core";
export function render(root, props) {
  let products = _signal(Array.from({
    length: 1000
  }, (_, i) => ({
    id: i,
    name: `Product ${i}`,
    price: Math.floor(Math.random() * 1000)
  })));
  const shuffle = () => {
    const arr = [...products.value];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    products.value = arr;
  };
  const reverse = () => {
    products.value = [...products.value].reverse();
  };
  const rootElement = (() => {
    const el0 = document.createElement("div");
    const el1 = document.createElement("div");
    el1.className = "flex justify-between items-center mb-6";
    const el2 = document.createElement("h1");
    el2.className = "text-2xl font-bold text-white";
    const text3 = document.createTextNode("Products (1000 items)");
    el2.appendChild(text3);
    el1.appendChild(el2);
    const el4 = document.createElement("div");
    el4.className = "space-x-4";
    const el5 = document.createElement("button");
    el5.onclick = shuffle;
    el5.className = "bg-indigo-600 px-4 py-2 rounded text-white hover:bg-indigo-500 transition-colors";
    const text6 = document.createTextNode("Shuffle List");
    el5.appendChild(text6);
    el4.appendChild(el5);
    const el7 = document.createElement("button");
    el7.onclick = reverse;
    el7.className = "bg-slate-700 px-4 py-2 rounded text-white hover:bg-slate-600 transition-colors";
    const text8 = document.createTextNode("Reverse List");
    el7.appendChild(text8);
    el4.appendChild(el7);
    el1.appendChild(el4);
    el0.appendChild(el1);
    const el9 = document.createElement("div");
    el9.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4";
    const mapped10 = _mapped(() => products.value, p => (() => {
      const el0 = document.createElement("div");
      el0._key = p.id;
      el0.className = "p-4 bg-slate-800 rounded border border-slate-700 hover:border-indigo-500 transition-all";
      const el1 = document.createElement("div");
      el1.className = "font-bold text-white";
      _renderDynamic(el1, () => p.name);
      el0.appendChild(el1);
      const el2 = document.createElement("div");
      el2.className = "text-slate-400 mt-1";
      const text3 = document.createTextNode("$");
      el2.appendChild(text3);
      _renderDynamic(el2, () => p.price);
      el0.appendChild(el2);
      const el4 = document.createElement("input");
      el4.setAttribute("placeholder", "Add note...");
      el4.className = "mt-2 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 focus:outline-none focus:border-indigo-500";
      el0.appendChild(el4);
      return el0;
    })());
    _renderDynamic(el9, () => mapped10);
    el0.appendChild(el9);
    return el0;
  })();
  root.appendChild(rootElement);
}