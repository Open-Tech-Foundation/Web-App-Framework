export interface DocsNavLink {
  label: string;
  href: string;
  icon?: string;
  external?: boolean;
}
export interface DocsFooter { text?: string; links?: DocsNavLink[] }
export type ProxyConfig = Record<string, string | { target: string }>;
export interface DocsConfig {
  title?: string;
  description?: string;
  version?: string;
  logo?: string;
  homeUrl?: string;
  github?: string;
  repoUrl?: string;
  dir?: string;
  nav?: DocsNavLink[];
  footer?: DocsFooter;
  search?: { provider?: string };
  lastUpdated?: boolean;
}
export interface BlogConfig {
  dir?: string;
  title?: string;
  description?: string;
  lastUpdated?: boolean;
}
export interface SiteConfig {
  site?: { url?: string };
  docs?: DocsConfig;
  blog?: BlogConfig;
  proxy?: ProxyConfig;
}
/** Identity helper; preserves the supplied configuration's inferred shape. */
export function defineDocsConfig<T extends SiteConfig>(config: T): T;
export default defineDocsConfig;
