// Public barrel for @opentf/web-docs.
//
// Components are shipped as JSX source and compiled by the consuming app's pipeline
// (the `@opentf/web` Link.jsx model) — each becomes a `web-*` Custom Element with
// CSR + SSG renderers for free. otfwc compiles JSX tags to element *strings*
// (`web-callout`), so the JS import of a component would be tree-shaken; the bare
// `import "./components/X.jsx"` retains its `customElements.define` side effect
// (the compiled modules are marked side-effectful), and the re-export lets authors
// pull a component in by name (`import { Callout } from "@opentf/web-docs"`).

import "./components/DocsLayout.jsx";
import "./components/Navbar.jsx";
import "./components/Sidebar.jsx";
import "./components/SidebarNode.jsx";
import "./components/Toc.jsx";
import "./components/Footer.jsx";
import "./components/Breadcrumbs.jsx";
import "./components/Pagination.jsx";
import "./components/ThemeToggle.jsx";
import "./components/SearchTrigger.jsx";
import "./components/Callout.jsx";
import "./components/Tabs.jsx";
import "./components/CodeGroup.jsx";
import "./components/Table.jsx";

export { default as DocsLayout } from "./components/DocsLayout.jsx";
export { default as Navbar } from "./components/Navbar.jsx";
export { default as Sidebar } from "./components/Sidebar.jsx";
export { default as Toc } from "./components/Toc.jsx";
export { default as Footer } from "./components/Footer.jsx";
export { default as Breadcrumbs } from "./components/Breadcrumbs.jsx";
export { default as Pagination } from "./components/Pagination.jsx";
export { default as ThemeToggle } from "./components/ThemeToggle.jsx";
export { default as SearchTrigger } from "./components/SearchTrigger.jsx";
export { default as Callout } from "./components/Callout.jsx";
export { default as Tabs } from "./components/Tabs.jsx";
export { default as CodeGroup } from "./components/CodeGroup.jsx";
export { default as Table } from "./components/Table.jsx";
