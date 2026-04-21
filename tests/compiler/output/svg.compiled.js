import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { signal, effect as _effect, signal as _signal } from "@preact/signals";
class SvgTestElement extends HTMLElement {
  static observedAttributes = [];
  constructor() {
    super();
    this._propsSignals = {};
  }
  attributeChangedCallback(name, _, value) {
    this._propsSignals[name].value = value;
  }
  connectedCallback() {
    this._onMounts = [];
    this._onCleanups = [];
    const props = _createPropsProxy(this);
    _withInstance(this, () => {
      const strokeWidth = signal(2);
      const rootElement = (() => {
        const el0 = document.createElement("svg");
        el0.setAttribute("width", "100");
        el0.setAttribute("height", "100");
        el0.setAttribute("view-box", "0 0 100 100");
        const el1 = document.createElement("circle");
        el1.setAttribute("cx", "50");
        el1.setAttribute("cy", "50");
        el1.setAttribute("r", "40");
        el1.setAttribute("stroke", "red");
        _effect(() => el1.setAttribute("stroke-width", strokeWidth.value));
        el1.setAttribute("fill", "transparent");
        el0.appendChild(el1);
        const el2 = document.createElement("path");
        el2.setAttribute("d", "M 10 10 L 90 90");
        el2.setAttribute("stroke", "blue");
        el2.setAttribute("stroke-linecap", "round");
        el0.appendChild(el2);
        return el0;
      })();
      while (this.firstChild) rootElement.appendChild(this.firstChild);
      this.appendChild(rootElement);
    });
    this._onMounts.forEach(fn => fn());
  }
  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
  }
}
customElements.define("waf-svgtest", SvgTestElement);
export default SvgTestElement;