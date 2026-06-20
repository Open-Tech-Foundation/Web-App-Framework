import { _mapped } from "./dom.js";
import { withInstance } from "./lifecycle.js";

export function For(props) {
  // We return a "marker" that renderDynamic will handle
  // But wait, if we are called as a component, we need to render something.
  return _mapped(props.each, props.children[0]);
}

// Register as a Web Component to support <For> syntax
class ForElement extends HTMLElement {
  connectedCallback() {
    const each = this._propsSignals?.each;
    const renderFn = this.childNodes[0]; // Wait, this is tricky
    // ...
  }
}
