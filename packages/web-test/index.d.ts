import type { BoundFunctions, queries } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";

/** A component factory, a registered custom-element class exposing `.tag`, or a tag name. */
export type RenderTarget<P extends object = any> =
  | ((props: P) => Node)
  | (CustomElementConstructor & { tag: string })
  | string;

export type RenderResult = BoundFunctions<typeof queries> & {
  /** The detached-by-`unmount` wrapper the component was mounted into. */
  container: HTMLElement;
  /** Dispose the component's reactive scope and remove its container. Idempotent. */
  unmount(): void;
};

/** Mount a component, page factory, or custom element and bind DOM queries to it. */
export function render<P extends object>(Component: RenderTarget<P>, props?: P): RenderResult;

/** Unmount everything `render` mounted. `@opentf/web-test/setup` runs it after each test. */
export function cleanup(): void;

export { userEvent };
