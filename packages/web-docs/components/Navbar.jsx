// Top navigation bar: brand, top-level links, search, GitHub, theme toggle. All
// content is driven by the `docs` config object passed down from DocsLayout.

import { Link } from "@opentf/web";
import ThemeToggle from "./ThemeToggle.jsx";
import SearchTrigger from "./SearchTrigger.jsx";

export default function Navbar(props) {
  const config = props.config || {};
  const links = config.nav || [];

  return (
    <header class="otfw-navbar">
      <div class="otfw-navbar-inner">
        <Link href={config.homeUrl || "/"} class="otfw-navbar-brand">
          {config.logo ? <img src={config.logo} alt="" class="otfw-navbar-logo" /> : null}
          <span class="otfw-navbar-title">{config.title || "Docs"}</span>
        </Link>

        <nav class="otfw-navbar-nav">
          {links.map((l) => (
            <Link href={l.href} class="otfw-navbar-link">
              {l.label}
            </Link>
          ))}
        </nav>

        <div class="otfw-navbar-actions">
          <SearchTrigger />
          {config.github ? (
            <a href={config.github} target="_blank" rel="noreferrer" class="otfw-navbar-icon" aria-label="GitHub">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0C17 4.7 18 5 18 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5a11.5 11.5 0 007.9-10.9C23.5 5.7 18.3.5 12 .5z" />
              </svg>
            </a>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
