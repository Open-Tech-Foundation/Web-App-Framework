/** Type-only JSX entry for the OTF compiler (`jsx: "preserve"`). */
export namespace JSX {
  type Element = Node;
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicAttributes { key?: string | number }

  type Handler<E, T extends Event> = (event: T & { currentTarget: E }) => void;
  type Events<E> = {
    [K in keyof GlobalEventHandlersEventMap as `on${K}`]?: Handler<E, GlobalEventHandlersEventMap[K]>;
  } & {
    [K in keyof GlobalEventHandlersEventMap as `on${Capitalize<K>}`]?: Handler<E, GlobalEventHandlersEventMap[K]>;
  };
  type Common<E> = Events<E> & {
    children?: unknown;
    class?: string | Record<string, unknown> | unknown[];
    className?: string;
    style?: string | Record<string, string | number | undefined>;
    ref?: { value: E | null | undefined };
    tabindex?: number;
    autofocus?: boolean;
    readonly?: boolean;
    contenteditable?: boolean | "true" | "false" | "plaintext-only";
    spellcheck?: boolean;
    for?: string;
    role?: string;
    [attribute: `data-${string}`]: unknown;
    [attribute: `aria-${string}`]: string | number | boolean | undefined;
  };
  type Properties<E> = {
    [K in keyof E as E[K] extends Function ? never : K extends `on${string}` | keyof Common<E> ? never : K]?: E[K];
  };
  type HTML = { [K in keyof HTMLElementTagNameMap]: Properties<HTMLElementTagNameMap[K]> & Common<HTMLElementTagNameMap[K]> };
  type SVG = { [K in Exclude<keyof SVGElementTagNameMap, keyof HTML>]: Common<SVGElementTagNameMap[K]> & { [attribute: string]: unknown } };
  type IntrinsicElements = HTML & SVG & {
    [tag: `${string}-${string}`]: Common<HTMLElement> & { [attribute: string]: unknown };
  };
}
