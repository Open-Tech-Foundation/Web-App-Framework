export interface DocsNavItem {
  title: string;
  path?: string;
  order?: number | string;
  items?: DocsNavItem[];
}
export type DocsNavMap = Record<string, DocsNavItem[]>;
declare const nav: DocsNavMap;
export default nav;
