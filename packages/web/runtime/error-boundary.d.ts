/**
 * Report a caught render/mount error and route it to the nearest enclosing
 * `<ErrorBoundary>`. Called from a throwing component's connectedCallback catch.
 */
export function handleError(el: any, error: any, context?: {}): void;
export class ErrorBoundaryElement extends HTMLElement {
    set fallback(fn: any);
    get fallback(): any;
    _fallback: any;
    connectedCallback(): void;
    _mounted: boolean | undefined;
    _blueprint: ChildNode[] | undefined;
    catch(error: any): void;
    _failed: boolean | undefined;
    reset(): void;
    #private;
}
/** JSX props consumed by the compiler-generated custom-element host. */
export const ErrorBoundary: { new(props: { fallback: (error: unknown, reset: () => void) => unknown; children?: unknown }): ErrorBoundaryElement; prototype: ErrorBoundaryElement };
