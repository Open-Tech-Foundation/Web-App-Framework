export class CodeBlockElement extends HTMLElement {
    set html(v: any);
    get html(): any;
    _html: any;
    _adopted: boolean | undefined;
    _applied: any;
    connectedCallback(): void;
    _rendered: boolean | undefined;
    render(): void;
    /** Wire the copy button to the block's `<pre>` text (idempotent). */
    wireCopy(): void;
}
/** JSX props consumed by the compiler-generated custom-element host. */
export const CodeFence: { new(props: { html: string }): CodeBlockElement; prototype: CodeBlockElement };
