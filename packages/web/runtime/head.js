import { renderHead } from "../core/metadata.js";

let fallbackTitle = "";
let baseUrl = "";

export function prepareRouteHead(hydrate) {
  baseUrl = window.location.origin;
  const canonical = document.head.querySelector('link[rel="canonical"]')?.href;
  if (canonical) {
    try { baseUrl = new URL(canonical, window.location.href).origin; } catch {}
  }
  fallbackTitle = hydrate ? "" : document.title;
}

/** Replace route SEO while preserving styles, executable scripts and viewport. */
export function updateRouteHead(metadata, path) {
  const template = document.createElement("template");
  template.innerHTML = renderHead(metadata, { path, baseUrl, managed: true });
  for (const node of [...document.head.children]) {
    const name = node.getAttribute("name") || "";
    const property = node.getAttribute("property") || "";
    if (node.hasAttribute("data-otfw-head") || node.localName === "title" ||
        (node.localName === "meta" && (["description", "robots"].includes(name) || name.startsWith("twitter:") || property.startsWith("og:") || property.startsWith("article:"))) ||
        (node.localName === "link" && node.getAttribute("rel") === "canonical") ||
        (node.localName === "script" && node.getAttribute("type") === "application/ld+json")) node.remove();
  }
  document.head.append(...template.content.childNodes);
  if (!document.head.querySelector("title") && fallbackTitle) document.title = fallbackTitle;
}
