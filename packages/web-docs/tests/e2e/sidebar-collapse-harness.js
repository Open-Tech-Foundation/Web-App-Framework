// Entry for the sidebar-collapse browser e2e (built by sidebar-collapse.mjs). It mounts
// <Sidebar> in the desktop docs grid against the real web-docs theme CSS, with a nav
// deep enough to exercise the collapsible groups: a top-level group (auto-expanded) that
// holds both a nested group (collapsed by default) and a plain link.
//
// The point of doing this in a real browser is the CSS the happy-dom unit tests
// (tests/MobileDrawer.test.js) can't see: the chevron rotation on `.is-open`, the child
// list actually gaining layout when expanded, and the reduced-motion transition guard.
import Sidebar from "../../components/Sidebar.jsx";
import SidebarToggle from "../../components/SidebarToggle.jsx";

const NAV = [
  { title: "Introduction", path: "/docs" },
  {
    title: "Guide",
    items: [
      { title: "Concepts", items: [{ title: "Deep Dive", path: "/docs/guide/concepts/deep" }] },
      { title: "Routing", path: "/docs/guide/routing" },
    ],
  },
];
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
];

const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

// A minimal navbar so the burger's globals resolve exactly as in the real layout.
const navbar = el("header", "otfw-navbar");
const inner = el("div", "otfw-navbar-inner");
const lead = el("div", "otfw-navbar-lead");
lead.append(document.createElement(SidebarToggle.tag));
inner.append(lead);
navbar.append(inner);

// Docs grid: the drawer is the sticky first column on desktop.
const docs = el("div", "otfw-docs");
const drawer = document.createElement(Sidebar.tag);
drawer.nav = NAV; // object props set before connect so they're read at mount
drawer.config = { nav: NAV_LINKS };
const main = el("main", "otfw-docs-main");
main.innerHTML = "<h1>Harness</h1><p>Long content.</p>".repeat(20);
docs.append(drawer, main);

document.body.append(navbar, docs);
