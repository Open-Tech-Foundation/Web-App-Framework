import { applySpread as _applySpread, effect as _effect, renderDynamic as _renderDynamic, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
import { createForm } from "@opentf/web-form";
class FormCaseElement extends HTMLElement {
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
      const form = createForm({
        initialValues: {
          name: "Alice"
        }
      });
      const rootElement = (() => {
        const el0 = document.createElement("div");
        const el1 = document.createElement("input");
        _effect(() => _applySpread(el1, form.register('name')));
        el0.appendChild(el1);
        const el2 = document.createElement("p");
        const text3 = document.createTextNode("Hello, ");
        el2.appendChild(text3);
        _renderDynamic(el2, () => form.values.name);
        el0.appendChild(el2);
        const el4 = document.createElement("button");
        el4.onclick = form.handleSubmit(v => console.log(v));
        const text5 = document.createTextNode(" Submit ");
        el4.appendChild(text5);
        el0.appendChild(el4);
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
customElements.define("web-formcase", FormCaseElement);
export default FormCaseElement;