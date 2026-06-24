// Pagefind-backed search modal (Phase 2). The navbar's `SearchTrigger` and the global
// ⌘K / Ctrl+K shortcut open it via `window.__otfwOpenSearch`, which this component
// installs on mount. The static index is generated at build time (`otfw build --ssg`
// with `docs.search.provider === "pagefind"`) and lives at `/pagefind/`; we load its
// runtime on first open so pages without a search never pay for it.
//
// Note: results only exist against a built site (`dist/`). In dev there is no index,
// so the modal opens but reports no results — expected.
import { onMount, router, RawHtml, Portal } from "@opentf/web";

let pagefindPromise = null;
function loadPagefind() {
  if (!pagefindPromise) {
    // A non-literal specifier keeps the bundler from trying to resolve the index at
    // build time (it doesn't exist yet) — it stays a runtime import of the static file.
    const path = "/pagefind/pagefind.js";
    pagefindPromise = import(/* @vite-ignore */ path).then(async (pf) => {
      await pf.init?.();
      return pf;
    });
  }
  return pagefindPromise;
}

export default function Search() {
  let open = $state(false);
  let query = $state("");
  let results = $state([]);
  let active = $state(0);
  let loading = $state(false);
  const inputRef = $ref();

  let timer;
  let token = 0;

  async function runSearch(q) {
    const mine = ++token;
    if (!q.trim()) {
      results = [];
      loading = false;
      return;
    }
    loading = true;
    try {
      const pf = await loadPagefind();
      const search = await pf.search(q);
      const top = (search.results || []).slice(0, 6);
      const data = await Promise.all(top.map((r) => r.data()));
      if (mine !== token) return; // a newer query superseded this one
      // Flatten to heading-anchored sub-results so each row deep-links to the matched
      // section (`/page/#heading`) rather than the page top. Pagefind builds these from
      // the body's headings; a page with none falls back to a single page-level row.
      const flat = [];
      for (const d of data) {
        const crumb = d.meta && d.meta.breadcrumb ? d.meta.breadcrumb.replace(/\s*\/\s*/g, " › ") : "";
        const subs =
          d.sub_results && d.sub_results.length
            ? d.sub_results
            : [{ title: (d.meta && d.meta.title) || d.url, url: d.url, excerpt: d.excerpt }];
        for (const s of subs.slice(0, 4)) {
          flat.push({
            url: s.url,
            title: s.title || (d.meta && d.meta.title) || d.url,
            crumb,
            excerpt: s.excerpt,
          });
          if (flat.length >= 10) break;
        }
        if (flat.length >= 10) break;
      }
      results = flat;
      active = 0;
    } catch (e) {
      if (mine === token) results = [];
    } finally {
      if (mine === token) loading = false;
    }
  }

  $effect(() => {
    const q = query;
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(q), 150);
  });

  const focusInput = () => {
    const el = inputRef;
    if (el && typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => el.focus());
  };
  const openModal = () => {
    open = true;
    focusInput();
  };
  const close = () => {
    open = false;
    query = "";
    results = [];
    active = 0;
  };
  const go = (url) => {
    close();
    router.push(url);
  };

  onMount(() => {
    if (typeof window === "undefined") return;
    window.__otfwOpenSearch = openModal;
    const onKey = (e) => {
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "k") {
        e.preventDefault();
        openModal();
        return;
      }
      if (!open) return;
      if (k === "Escape") close();
      else if (k === "ArrowDown") {
        e.preventDefault();
        active = results.length ? (active + 1) % results.length : 0;
      } else if (k === "ArrowUp") {
        e.preventDefault();
        active = results.length ? (active - 1 + results.length) % results.length : 0;
      } else if (k === "Enter" && results[active]) {
        e.preventDefault();
        go(results[active].url);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (window.__otfwOpenSearch === openModal) delete window.__otfwOpenSearch;
    };
  });

  // Portal to <body>: the navbar (our render parent) sets `backdrop-filter`, which
  // establishes a containing block for fixed-position descendants — so without this the
  // `position: fixed` overlay would collapse to the navbar's box instead of the viewport.
  return (
    <Portal>
    <div
      class={open ? "otfw-search-modal is-open" : "otfw-search-modal"}
      onclick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class="otfw-search-panel" role="dialog" aria-label="Search docs">
        <div class="otfw-search-field">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke-linecap="round" />
          </svg>
          <input
            ref={inputRef}
            class="otfw-search-input-field"
            type="search"
            placeholder="Search docs…"
            aria-label="Search docs"
            value={query}
            oninput={(e) => (query = e.target.value)}
          />
          <kbd class="otfw-search-esc">Esc</kbd>
        </div>
        <ul class="otfw-search-results">
          {results.map((r, i) => (
            <li>
              <a
                href={r.url}
                class={i === active ? "otfw-search-result is-active" : "otfw-search-result"}
                onclick={(e) => {
                  e.preventDefault();
                  go(r.url);
                }}
                onmouseenter={() => (active = i)}
              >
                {r.crumb ? <span class="otfw-search-result-crumb">{r.crumb}</span> : null}
                <span class="otfw-search-result-title">{r.title}</span>
                <span class="otfw-search-result-excerpt">
                  <RawHtml html={r.excerpt} />
                </span>
              </a>
            </li>
          ))}
        </ul>
        {query.trim() && !loading && results.length === 0 ? (
          <div class="otfw-search-empty">No results for “{query}”.</div>
        ) : null}
      </div>
    </div>
    </Portal>
  );
}
