// Search box trigger in the navbar. Calls the global opener that the Pagefind-backed
// <Search> modal installs on `window` (the ⌘K / Ctrl+K shortcut opens it too).

export default function SearchTrigger() {
  const open = () => {
    if (typeof window !== "undefined" && typeof window.__otfwOpenSearch === "function") {
      window.__otfwOpenSearch();
    }
  };

  return (
    <button class="otfw-search-trigger" onclick={open} aria-label="Search docs">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" stroke-linecap="round" />
      </svg>
      <span class="otfw-search-label">Search</span>
    </button>
  );
}
