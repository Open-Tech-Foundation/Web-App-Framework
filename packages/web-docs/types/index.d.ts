import type { DocsConfig, DocsNavLink } from "./config.js";
import type { DocsNavItem, DocsNavMap } from "./nav.js";
import type { BlogPost } from "./posts.js";

export type { DocsConfig, DocsNavLink, DocsFooter, BlogConfig, SiteConfig, ProxyConfig } from "./config.js";
export type { DocsNavItem, DocsNavMap } from "./nav.js";
export type { BlogPost } from "./posts.js";
export { createSearch } from "./search.js";
export type { SearchOptions, SearchResult, SearchResponse, SearchClient } from "./search.js";

export interface ChildrenProps { children?: unknown }
export interface DocsLayoutProps extends ChildrenProps {
  config?: DocsConfig;
  nav?: DocsNavMap | DocsNavItem[];
  frame?: boolean;
  siteUrl?: string;
}
export interface BlogLayoutProps extends ChildrenProps {
  config?: DocsConfig;
  posts?: BlogPost[];
  frame?: boolean;
  indexPath?: string;
  siteUrl?: string;
}
export interface NavbarProps {
  config?: DocsConfig;
  id?: string;
  navLabel?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}
export function DocsLayout(props: DocsLayoutProps): Node;
export function BlogLayout(props: BlogLayoutProps): Node;
export function Navbar(props: NavbarProps): Node;
export function NavbarLink(props: { link?: DocsNavLink }): Node;
export function SidebarToggle(): Node;
export function NavIcon(props: { name: string }): Node;
export function Sidebar(props: { nav?: DocsNavItem[]; config?: DocsConfig }): Node;
export function Toc(): Node;
export function Footer(props: { config?: DocsConfig }): Node;
export function Breadcrumbs(props: { nav?: DocsNavItem[]; siteUrl?: string }): Node;
export function Pagination(props: { nav?: DocsNavItem[] }): Node;
export function LastUpdated(props: { date?: string | number | Date | null; label?: string }): Node | null;
export function ThemeToggle(): Node;
export function SearchTrigger(): Node;
export function Search(): Node;
export function Callout(props: ChildrenProps & { type?: "note" | "tip" | "info" | "warning" | "danger"; title?: string }): Node;
export function CodeBlock(props: { code: string; lang?: string; name?: string }): Node;
export function Tabs(props: {
  tabs?: { label: string; content: unknown }[];
  /** Accessible name for the tab list. */
  label?: string;
}): Node;
export function Steps(props: ChildrenProps): Node;
export function Table(props: ChildrenProps): Node;
export function Cards(props: ChildrenProps): Node;
export function Card(props: ChildrenProps & { href: string; title: string; desc?: string; external?: boolean }): Node;
export function Tooltip(props: ChildrenProps & { text: string; placement?: "top" | "bottom" }): Node;
export function PostList(props: { posts?: BlogPost[] }): Node;
export function PostCard(props: { post: BlogPost }): Node;
/** Banner and metadata accept a post object or individual post fields. */
export function PostBanner(props: { post: BlogPost } | Partial<BlogPost>): Node;
export function PostMeta(props: { post: BlogPost } | Partial<BlogPost>): Node;
export function ReadingTime(props: { minutes?: number }): Node;
