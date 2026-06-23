// Top navigation bar: brand, top-level links, search, GitHub, theme toggle. All
// content is driven by the `docs` config object passed down from DocsLayout.
// Top-level links support a per-item `icon` (NavIcon name) and `external` flag, and
// the active route is underlined (see NavbarLink). The search trigger only renders
// when a search provider is configured.

import ThemeToggle from "./ThemeToggle.jsx";
import SearchTrigger from "./SearchTrigger.jsx";
import NavbarLink from "./NavbarLink.jsx";
import NavIcon from "./NavIcon.jsx";
import { Link } from "@opentf/web";

export default function Navbar(props) {
  const config = props.config || {};
  const links = config.nav || [];

  return (
    <header class="otfw-navbar">
      <div class="otfw-navbar-inner">
        <Link href={config.homeUrl || "/"} class="otfw-navbar-brand">
          {config.logo ? <img src={config.logo} alt="" class="otfw-navbar-logo" /> : null}
          <span class="otfw-navbar-title">{config.title || "Docs"}</span>
          {config.version ? <span class="otfw-navbar-version">{config.version}</span> : null}
        </Link>

        <nav class="otfw-navbar-nav">
          {links.map((l) => (
            <NavbarLink link={l} />
          ))}
        </nav>

        <div class="otfw-navbar-actions">
          {config.search ? <SearchTrigger /> : null}
          {config.github ? (
            <a href={config.github} target="_blank" rel="noreferrer" class="otfw-navbar-icon" aria-label="GitHub">
              <NavIcon name="github" />
            </a>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
