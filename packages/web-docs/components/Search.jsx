// OTF Search-backed modal. The navbar's `SearchTrigger` and the global
// ⌘K / Ctrl+K shortcut open it via `window.__otfwOpenSearch`, which this component
// installs on mount. The static index is generated after a release build (the `siteOutputPlugin`
// output hook, with `docs.search.provider === "otf"`) lives at `/_search/`; the reader is lazy so
// pages without a search never fetch its index.
//
// Note: results only exist against a built site (`dist/`). In dev there is no index,
// so the modal opens but reports no results — expected.
import { onCleanup, onMount, router, Portal } from "@opentf/web";
import { createSearch, excerptParts } from "../search.js";

const search = createSearch({ base: "/_search/" });

export default function Search() {
  let open = $state(false);
  let query = $state("");
  let results = $state([]);
  let active = $state(0);
  let loading = $state(false);
  let error = $state("");
  let controller;
  const inputRef = $ref();

  let timer;
  let token = 0;

  async function runSearch(q) {
    const mine = ++token;
    controller?.abort();
    controller = new AbortController();
    error = "";
    if (!q.trim()) {
      results = [];
      loading = false;
      return;
    }
    loading = true;
    try {
      const found = await search.query(q, { limit: 10, signal: controller.signal });
      if (mine !== token) return; // a newer query superseded this one
      results = found.results;
      active = 0;
    } catch (e) {
      if (mine === token && e?.name !== "AbortError") {
        results = [];
        error = "Search is unavailable. Please try again.";
      }
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
    ++token;
    controller?.abort();
    clearTimeout(timer);
    loading = false;
    error = "";
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

  onCleanup(() => {
    ++token;
    clearTimeout(timer);
    controller?.abort();
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
                {r.meta?.breadcrumb ? <span class="otfw-search-result-crumb">{r.meta.breadcrumb}</span> : null}
                <span class="otfw-search-result-title">{r.title}</span>
                {r.section ? <span class="otfw-search-result-section">{r.section}</span> : null}
                <span class="otfw-search-result-excerpt">
                  {excerptParts(r.excerpt, r.highlights).map((part) => <span>{part.match ? <mark>{part.text}</mark> : part.text}</span>)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {error ? <div class="otfw-search-empty" role="status">{error}</div> : null}
        {query.trim() && !loading && !error && results.length === 0 ? (
          <div class="otfw-search-empty">No results for “{query}”.</div>
        ) : null}
        <div class="otfw-search-hint">
          <span class="otfw-search-hint-item">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            navigate
          </span>
          <span class="otfw-search-hint-item">
            <kbd>↵</kbd>
            select
          </span>
          <span class="otfw-search-hint-item">
            <kbd>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
    </Portal>
  );
}
