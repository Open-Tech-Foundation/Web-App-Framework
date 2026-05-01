import { applySpread as _applySpread, effect as _effect, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
class SpreadTestElement extends HTMLElement {
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
    this._children = Array.from(this.childNodes);
    while (this.firstChild) this.removeChild(this.firstChild);
    _withInstance(this, () => {
      const props = {
        id: "test",
        className: "foo",
        "data-custom": "bar"
      };
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _effect(() => _applySpread(el0, props));
        const el1 = document.createElement("span");
        _effect(() => _applySpread(el1, {
          style: {
            color: "red"
          }
        }));
        const text2 = document.createTextNode("Hello");
        el1.appendChild(text2);
        el0.appendChild(el1);
        return el0;
      })();
      this.appendChild(rootElement);
    });
    this._onMounts.forEach(fn => fn());
  }
  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
  }
}
customElements.define("web-spreadtest", SpreadTestElement);
export default SpreadTestElement;