// Theme switcher: a subtle ghost icon button that opens a Light / Dark / System menu.
//
// The chosen *mode* is persisted to localStorage("theme") as "light" | "dark" |
// "system" (default "system"). The applied theme is the resolved value — in System
// mode it follows the OS and live-updates when the OS preference flips. The trigger
// shows the mode's icon; in System mode it shows the monitor icon plus a small badge of
// the currently resolved icon (sun/moon), so you can see both the choice and the result.
//
// Pair with the no-flash inline script in index.html, which must resolve "system"/none
// to a concrete theme on first paint.

import { onMount } from "@opentf/web";

import Tooltip from "./Tooltip.jsx";

const STORAGE_KEY = "theme";
const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export default function ThemeToggle() {
  let mode = $state("system"); // "light" | "dark" | "system"
  let resolved = $state("light"); // "light" | "dark"
  let openMenu = $state(false);

  const rootRef = $ref();

  const resolve = (m) => (m === "system" ? (prefersDark() ? "dark" : "light") : m);

  const apply = (m) => {
    resolved = resolve(m);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", resolved);
    }
  };

  const setMode = (m) => {
    mode = m;
    openMenu = false;
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {}
    apply(m);
  };

  onMount(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    mode = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    apply(mode);

    // Follow the OS while in System mode.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onOS = () => mode === "system" && apply("system");
    mql.addEventListener?.("change", onOS);

    // Close the menu on outside click / Escape.
    const onDocClick = (e) => {
      if (openMenu && rootRef && !rootRef.contains(e.target)) openMenu = false;
    };
    const onKey = (e) => e.key === "Escape" && (openMenu = false);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);

    return () => {
      mql.removeEventListener?.("change", onOS);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div class="otfw-theme" ref={rootRef}>
      <Tooltip text="Change theme">
        <button
          class="otfw-navbar-icon otfw-theme-trigger"
          onclick={(e) => {
            e.stopPropagation();
            openMenu = !openMenu;
          }}
          aria-label="Change theme"
          aria-haspopup="menu"
          aria-expanded={openMenu ? "true" : "false"}
        >
          {() =>
            mode === "system" ? (
              <span class="otfw-theme-trigger-system">
                <MonitorIcon />
                <span class="otfw-theme-trigger-badge">
                  {resolved === "dark" ? <MoonIcon small /> : <SunIcon small />}
                </span>
              </span>
            ) : mode === "dark" ? (
              <MoonIcon />
            ) : (
              <SunIcon />
            )
          }
        </button>
      </Tooltip>

      {() =>
        openMenu ? (
          <div class="otfw-theme-menu" role="menu">
            <MenuItem active={mode === "light"} onclick={() => setMode("light")}>
              <SunIcon small /> Light
            </MenuItem>
            <MenuItem active={mode === "dark"} onclick={() => setMode("dark")}>
              <MoonIcon small /> Dark
            </MenuItem>
            <MenuItem active={mode === "system"} onclick={() => setMode("system")}>
              <MonitorIcon small /> System
            </MenuItem>
          </div>
        ) : null
      }
    </div>
  );
}

function MenuItem(props) {
  return (
    <button
      class={props.active ? "otfw-theme-item is-active" : "otfw-theme-item"}
      role="menuitemradio"
      aria-checked={props.active ? "true" : "false"}
      onclick={props.onclick}
    >
      {props.children}
    </button>
  );
}

function SunIcon(props) {
  const s = props.small ? 15 : 17;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 5a7 7 0 100 14 7 7 0 000-14z" />
    </svg>
  );
}

function MoonIcon(props) {
  const s = props.small ? 15 : 17;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

function MonitorIcon(props) {
  const s = props.small ? 15 : 17;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
