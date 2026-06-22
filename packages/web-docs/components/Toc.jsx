// "On this page" table of contents. Built from the rendered content headings (so it
// works for both MDX and JSX pages), with scroll-spy highlighting via
// IntersectionObserver. Rebuilds on route change.
//
// The MDX front-end already emits stable heading ids (slugs); we read them from the
// DOM after mount. (SSG output ships the heading anchors statically; this nav chrome
// activates once the client bundle mounts.)

import { onMount, router } from "@opentf/web";

export default function Toc() {
  let items = $state([]);
  let activeId = $state("");
  let observer = null;

  const build = () => {
    if (typeof document === "undefined") return;
    const root = document.getElementById("otfw-content");
    if (!root) return;
    const hs = Array.from(root.querySelectorAll("h2[id], h3[id]"));
    items = hs.map((h) => ({
      id: h.id,
      text: h.textContent || "",
      sub: h.tagName === "H3",
    }));
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) activeId = e.target.id;
      },
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
    );
    for (const h of hs) observer.observe(h);
  };

  onMount(() => {
    build();
    return () => observer && observer.disconnect();
  });

  // Rebuild when the route changes (content swaps under the same layout).
  $effect(() => {
    router.pathname;
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(build);
  });

  return (
    <nav class="otfw-toc" aria-label="On this page">
      {() =>
        items.length > 0 ? (
          <div class="otfw-toc-inner">
            <div class="otfw-toc-heading">On this page</div>
            <ul class="otfw-toc-list">
              {items.map((h) => (
                <li class={h.sub ? "otfw-toc-item otfw-toc-sub" : "otfw-toc-item"}>
                  <a
                    href={"#" + h.id}
                    class={activeId === h.id ? "otfw-toc-link otfw-active" : "otfw-toc-link"}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
    </nav>
  );
}
