import type { Signal } from "./signals.js";
export interface Context<T> { id: string; fallback: Signal<T> }
export function createContext<T>(defaultValue: T): Context<T>;
export function readContext<T>(context: Context<T>): Signal<T>;
export function enterHost(element: Element): void;
export function exitHost(): void;
export function getCurrentInstance(): Element | null;
