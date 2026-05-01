import { computed as _computed, effect as _effect, renderDynamic as _renderDynamic, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
import { createForm } from "@opentf/web-form";
export class BasicForm extends HTMLElement {
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
          username: ""
        }
      });
      const isValid = _computed(() => form.isValid);
      const isSubmitting = _computed(() => form.isSubmitting);
      const canSubmit = _computed(() => isValid.value && !isSubmitting.value);
      const rootElement = (() => {
        const el0 = document.createElement("section");
        const el1 = document.createElement("button");
        el1.setAttribute("type", "submit");
        _effect(() => el1.disabled = () => !canSubmit.value);
        _renderDynamic(el1, () => () => isSubmitting.value ? "Processing..." : "Save Changes");
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
customElements.define("web-basicform", BasicForm);