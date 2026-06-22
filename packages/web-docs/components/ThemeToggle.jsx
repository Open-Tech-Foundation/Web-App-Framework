// Light/dark toggle. Sets `data-theme` on <html>, persists to localStorage, and
// respects the OS preference on first load. Pair with the no-flash inline script in
// the docs shell index.html so the initial paint already has the right theme.

import { onMount } from "@opentf/web";

export default function ThemeToggle() {
  let theme = $state("light");

  onMount(() => {
    const saved =
      localStorage.getItem("theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    theme = saved;
    document.documentElement.setAttribute("data-theme", theme);
  });

  const toggle = () => {
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  };

  return (
    <button class="otfw-theme-toggle" onclick={toggle} aria-label="Toggle color theme">
      {() =>
        theme === "light" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 5a7 7 0 100 14 7 7 0 000-14z" />
          </svg>
        )
      }
    </button>
  );
}
