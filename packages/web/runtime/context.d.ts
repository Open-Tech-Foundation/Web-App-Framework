export { createContext, readContext, enterHost, exitHost, getCurrentInstance } from "../core/context.js";

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
