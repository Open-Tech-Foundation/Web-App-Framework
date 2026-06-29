// Entry for the mobile-drawer browser e2e (built by mobile-drawer.mjs). It mounts ONLY
// the two drawer components — <Sidebar> (the drawer) and <SidebarToggle> (the navbar
// burger) — inside a minimal navbar + docs grid, against the real web-docs theme CSS.
//
// Isolating the drawer here (rather than driving the full pre-rendered website) keeps
// the e2e fast, dependency-free (no `otfw build` of the site), and focused on the one
// thing happy-dom can't check: the CSS-dependent behavior (off-canvas transform, the
// 768px breakpoint, the slide-in, the backdrop, the body-scroll lock).
import Sidebar from "../../components/Sidebar.jsx";
import SidebarToggle from "../../components/SidebarToggle.jsx";

const NAV = [
  { title: "Introduction", path: "/docs" },
  { title: "Guide", items: [{ title: "Routing", path: "/docs/routing" }] },
];

const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

// Navbar with the burger in the lead zone, exactly how Navbar.jsx composes it.
const navbar = el("header", "otfw-navbar");
const inner = el("div", "otfw-navbar-inner");
const lead = el("div", "otfw-navbar-lead");
const brand = el("a", "otfw-navbar-brand");
brand.href = "/";
brand.textContent = "Docs";
lead.append(document.createElement(SidebarToggle.tag), brand);
inner.append(lead, el("div", "otfw-navbar-search"), el("div", "otfw-navbar-right"));
navbar.append(inner);

// Docs grid: the drawer is the first column on desktop, the off-canvas drawer on mobile.
const docs = el("div", "otfw-docs");
const drawer = document.createElement(Sidebar.tag);
drawer.nav = NAV; // object prop set before connect so it's read at mount
const main = el("main", "otfw-docs-main");
main.innerHTML = "<h1>Harness</h1><p>Long content.</p>".repeat(20);
docs.append(drawer, main);

document.body.append(navbar, docs);
