/** Push the current component host (compiler-emitted, paired with `exitHost`). */
export function enterHost(el: any): void;
/** Pop the current component host (compiler-emitted, in a `finally`). */
export function exitHost(): void;
/**
 * The component host element currently executing its body, or `null` outside a
 * component (e.g. a form created in module scope or a test). Libraries use this
 * as a per-instance identity to scope state to the mounting component — the
 * compiler emits `enterHost(this)` around every component body (csr.rs).
 */
export function getCurrentInstance(): any;
/**
 * Create a context with a default value. The returned token is passed to
 * `<ContextProvider context={…}>` and `$context(…)`.
 */
export function createContext(defaultValue: any): {
    id: string;
    fallback: {
        value: any;
        peek(): any;
    };
};
/**
 * Resolve the value provided by the nearest ancestor `ContextProvider` for
 * `context`, or the context's default if there is none. Returns a **signal**. This
 * is what the `$context(Ctx)` compiler macro lowers to; the macro registers the
 * binding as a signal so the bare name reads `.value` reactively.
 */
export function readContext(context: any): any;
export class ContextProviderElement extends HTMLElement {
    _signal: {
        value: any;
        peek(): any;
    };
    set context(ctx: any);
    set value(v: any);
    get value(): any;
}
/** JSX props consumed by the compiler-generated custom-element host. */
export const ContextProvider: { new(props: { context: { id: string; fallback: { value: unknown } }; value: unknown; children?: unknown }): ContextProviderElement; prototype: ContextProviderElement };
