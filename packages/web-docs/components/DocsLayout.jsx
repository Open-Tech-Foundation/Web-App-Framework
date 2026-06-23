// Top-level documentation frame: navbar + (sidebar · content · TOC) + footer.
//
//   import config from "../../otfw.config.js";
//   import nav from "@opentf/web-docs/nav";
//   export default function (props) {
//     return <DocsLayout config={config.docs} nav={nav}>{props.children}</DocsLayout>;
//   }
//
// `frame` (default true) renders the full chrome (navbar + footer). Pass
// `frame={false}` when nesting inside an existing site layout that already provides
// the navbar/footer — only the sidebar · content · TOC grid is rendered.

import Navbar from "./Navbar.jsx";
import Sidebar from "./Sidebar.jsx";
import Toc from "./Toc.jsx";
import Footer from "./Footer.jsx";
import Breadcrumbs from "./Breadcrumbs.jsx";
import Pagination from "./Pagination.jsx";

// Build-time highlighted code is a static `<pre>` (no reactive bindings), so we add
// the copy control as a progressive enhancement at runtime rather than threading a
// component through the MDX front-end. A MutationObserver re-decorates after every
// client navigation (the layout persists; only the article subtree swaps).
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function decorateCodeBlocks(root) {
  const blocks = root.querySelectorAll("pre");
  for (const pre of blocks) {
    if (pre.dataset.otfwCopy) continue;
    pre.dataset.otfwCopy = "1";

    const wrap = document.createElement("div");
    wrap.className = "otfw-code";
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "otfw-copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = COPY_ICON + '<span class="otfw-copy-label">Copy</span>';
    btn.addEventListener("click", () => {
      const code = (pre.querySelector("code") || pre).innerText;
      navigator.clipboard?.writeText(code);
      btn.classList.add("is-copied");
      btn.innerHTML = CHECK_ICON + '<span class="otfw-copy-label">Copied</span>';
      clearTimeout(btn._otfwT);
      btn._otfwT = setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = COPY_ICON + '<span class="otfw-copy-label">Copy</span>';
      }, 2000);
    });
    wrap.appendChild(btn);
  }
}

export default function DocsLayout(props) {
  const config = props.config || {};
  const nav = props.nav || [];
  const frame = props.frame !== false;

  const contentRef = $ref();

  onMount(() => {
    const root = contentRef;
    if (!root || typeof MutationObserver === "undefined") return;
    decorateCodeBlocks(root);
    const mo = new MutationObserver(() => decorateCodeBlocks(root));
    mo.observe(root, { childList: true, subtree: true });
    onCleanup(() => mo.disconnect());
  });

  const body = (
    <div class="otfw-docs">
      <Sidebar nav={nav} config={config} />
      <main id="otfw-content" class="otfw-content" data-pagefind-body ref={contentRef}>
        <Breadcrumbs nav={nav} />
        <article class="otfw-prose">{props.children}</article>
        <Pagination nav={nav} />
      </main>
      <Toc />
    </div>
  );

  return frame ? (
    <div class="otfw-shell">
      <Navbar config={config} />
      <div class="otfw-shell-body">{body}</div>
      <Footer config={config} />
    </div>
  ) : (
    body
  );
}
