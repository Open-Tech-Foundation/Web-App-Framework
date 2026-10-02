import type { JSX } from "../jsx-runtime.js";
export interface LinkProps {
  href: string;
  children?: unknown;
  class?: JSX.IntrinsicElements["a"]["class"];
  reload?: boolean | "";
  ariaLabel?: string;
  ariaCurrent?: string;
  "aria-label"?: string;
  "aria-current"?: string;
}
export default function Link(props: LinkProps): Node;
