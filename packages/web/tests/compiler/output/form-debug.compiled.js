import { renderDynamic as _renderDynamic, applySpread as _applySpread, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
import { createForm } from "@opentf/web-form";
export class FormField extends HTMLElement {
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
      const {
        label,
        name,
        ...rest
      } = props;
      const rootElement = (() => {
        const el0 = document.createElement("div");
        const el1 = document.createElement("label");
        _renderDynamic(el1, () => label);
        el0.appendChild(el1);
        const el2 = document.createElement("input");
        _applySpread(el2, rest);
        el2.onblur = rest.onblur;
        el0.appendChild(el2);
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
customElements.define("web-formfield", FormField);
export class TestForm extends HTMLElement {
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
          name: ""
        }
      });
      const rootElement = (() => {
        const el0 = document.createElement("form");
        const el1 = document.createElement("web-formfield");
        el1.label = "Name";
        _applySpread(el1, form.register("name"));
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
customElements.define("web-testform", TestForm);