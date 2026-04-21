export function render(root) {
  const rootElement = (() => {
    const el0 = document.createElement("div");
    const el1 = document.createElement("h1");
    const text2 = document.createTextNode("Hello");
    el1.appendChild(text2);
    el0.appendChild(el1);
    const el3 = document.createElement("p");
    const text4 = document.createTextNode("World");
    el3.appendChild(text4);
    el0.appendChild(el3);
    return el0;
  })();
  root.appendChild(rootElement);
}