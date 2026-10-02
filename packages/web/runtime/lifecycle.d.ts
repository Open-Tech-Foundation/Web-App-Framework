/** Compiler lifecycle macros; callbacks are wired to the component host. */
export function onMount(callback: () => void | (() => void)): void;
export function onCleanup(callback: () => void): void;
export function onResize(callback: (entry: ResizeObserverEntry) => void): void;
export function onMediaQuery(query: string, callback: (matches: boolean, event: MediaQueryListEvent | undefined) => void): void;
export function onVisibilityChange(callback: (visible: boolean, entry: IntersectionObserverEntry) => void): void;
