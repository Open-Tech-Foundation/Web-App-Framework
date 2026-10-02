export class RawHtmlElement extends HTMLElement {
    set html(v: any);
    get html(): any;
    _html: any;
    _adopted: boolean | undefined;
    _value: any;
    connectedCallback(): void;
    _applied: boolean | undefined;
}
/** JSX props consumed by the compiler-generated custom-element host. */
export const RawHtml: { new(props: { html: string }): RawHtmlElement; prototype: RawHtmlElement };
