export class PortalElement extends HTMLElement {
    set to(v: any);
    get to(): any;
    _to: any;
    connectedCallback(): void;
    _mounted: boolean | undefined;
    _relocate(): void;
    _moved: ChildNode[] | null | undefined;
    disconnectedCallback(): void;
}
/** JSX props consumed by the compiler-generated custom-element host. */
export const Portal: { new(props: { to: string | Element; children?: unknown }): PortalElement; prototype: PortalElement };
