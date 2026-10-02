/** Writable reactive value. */
export interface Signal<T> { value: T; peek(): T }
export function signal<T>(initial: T): Signal<T>;
export function computed<T>(fn: () => T): { readonly value: T; dispose(): void };
export function effect(fn: () => void | (() => void)): () => void;
export function untracked<T>(fn: () => T): T;
export function batch<T>(fn: () => T): T;
export function scope<T>(fn: () => T): { result: T; dispose(): void };
