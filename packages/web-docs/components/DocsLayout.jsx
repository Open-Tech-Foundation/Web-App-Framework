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

// Each code block ships a header with a copy button (built by the MDX front-end). The
// button markup is static HTML, so we wire its click with one delegated listener on
// the persistent content root — which keeps working as the article subtree swaps on
// navigation, with no per-element bookkeeping.
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

// For non-secure contexts / browsers without the async clipboard API.
function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {
    /* clipboard unavailable */
  }
}

function wireCopyButtons(root) {
  const onClick = (e) => {
    const btn = e.target.closest && e.target.closest(".otfw-copy");
    if (!btn || !root.contains(btn)) return;
    const pre = btn.closest(".otfw-code") && btn.closest(".otfw-code").querySelector("pre");
    copyText(pre ? pre.innerText : "");
    const label = btn.querySelector(".otfw-copy-label");
    btn.classList.add("is-copied");
    if (label) label.textContent = "Copied";
    clearTimeout(btn._otfwT);
    btn._otfwT = setTimeout(() => {
      btn.classList.remove("is-copied");
      if (label) label.textContent = "Copy";
    }, 2000);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}

export default function DocsLayout(props) {
  const config = props.config || {};
  const nav = props.nav || [];
  const frame = props.frame !== false;

  // Wire the copy buttons once with a single delegated listener on the content
  // root. We hold the root with a `$ref` (the value is live by the time `onMount`
  // runs). Delegation means one listener covers every code block, current and
  // future, as the article subtree swaps on navigation.
  const contentRef = $ref();
  onMount(() => {
    const root = contentRef;
    if (!root) return;
    return wireCopyButtons(root);
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
