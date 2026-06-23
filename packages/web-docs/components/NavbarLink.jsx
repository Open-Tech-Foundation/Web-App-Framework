// One top-level navbar link. Its own component (like SidebarNode) so the active
// state is a reactive binding in the element's own build — it updates on SPA
// navigation without re-rendering the whole navbar. `external` links render as a
// plain anchor (no SPA nav, no active state); internal links get the accent
// underline when the current route matches (exactly, or as a section prefix).

import { Link, router } from "@opentf/web";
import NavIcon from "./NavIcon.jsx";

export default function NavbarLink(props) {
  const link = props.link || {};

  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer" class="otfw-navbar-link">
      {link.icon ? <NavIcon name={link.icon} /> : null}
      {link.label}
    </a>
  ) : (
    <Link
      href={link.href}
      class={
        (link.href === "/"
          ? router.pathname === "/"
          : router.pathname === link.href || router.pathname.startsWith(link.href + "/"))
          ? "otfw-navbar-link otfw-active"
          : "otfw-navbar-link"
      }
    >
      {link.icon ? <NavIcon name={link.icon} /> : null}
      {link.label}
    </Link>
  );
}
