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
import "./components/LastUpdated.jsx";
import "./components/ThemeToggle.jsx";
import "./components/SearchTrigger.jsx";
import "./components/Search.jsx";
import "./components/Callout.jsx";
import "./components/CodeBlock.jsx";
import "./components/Tabs.jsx";
import "./components/Steps.jsx";
import "./components/Table.jsx";
import "./components/Cards.jsx";
import "./components/Card.jsx";
import "./components/BlogLayout.jsx";
import "./components/PostList.jsx";
import "./components/PostCard.jsx";
import "./components/PostBanner.jsx";
import "./components/PostMeta.jsx";
import "./components/ReadingTime.jsx";

export { default as DocsLayout } from "./components/DocsLayout.jsx";
export { default as Navbar } from "./components/Navbar.jsx";
export { default as NavbarLink } from "./components/NavbarLink.jsx";
export { default as NavIcon } from "./components/NavIcon.jsx";
export { default as Sidebar } from "./components/Sidebar.jsx";
export { default as Toc } from "./components/Toc.jsx";
export { default as Footer } from "./components/Footer.jsx";
export { default as Breadcrumbs } from "./components/Breadcrumbs.jsx";
export { default as Pagination } from "./components/Pagination.jsx";
export { default as LastUpdated } from "./components/LastUpdated.jsx";
export { default as ThemeToggle } from "./components/ThemeToggle.jsx";
export { default as SearchTrigger } from "./components/SearchTrigger.jsx";
export { default as Search } from "./components/Search.jsx";
export { default as Callout } from "./components/Callout.jsx";
export { default as CodeBlock } from "./components/CodeBlock.jsx";
export { default as Tabs } from "./components/Tabs.jsx";
export { default as Steps } from "./components/Steps.jsx";
export { default as Table } from "./components/Table.jsx";
export { default as Cards } from "./components/Cards.jsx";
export { default as Card } from "./components/Card.jsx";
export { default as BlogLayout } from "./components/BlogLayout.jsx";
export { default as PostList } from "./components/PostList.jsx";
export { default as PostCard } from "./components/PostCard.jsx";
export { default as PostBanner } from "./components/PostBanner.jsx";
export { default as PostMeta } from "./components/PostMeta.jsx";
export { default as ReadingTime } from "./components/ReadingTime.jsx";
