import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { renderDynamic as _renderDynamic } from "/framework/runtime/dom.js";
import { signal as _signal, effect as _effect } from "@preact/signals-core";
class ComplexExpressionsElement extends HTMLElement {
  static observedAttributes = ["theme", "color", "loading", "title", "logMessage"];
  set theme(val) {
    this._propsSignals["theme"].value = val;
  }
  set color(val) {
    this._propsSignals["color"].value = val;
  }
  set loading(val) {
    this._propsSignals["loading"].value = val;
  }
  set title(val) {
    this._propsSignals["title"].value = val;
  }
  set logMessage(val) {
    this._propsSignals["logMessage"].value = val;
  }
  get theme() {
    return this._propsSignals["theme"].value;
  }
  get color() {
    return this._propsSignals["color"].value;
  }
  get loading() {
    return this._propsSignals["loading"].value;
  }
  get title() {
    return this._propsSignals["title"].value;
  }
  get logMessage() {
    return this._propsSignals["logMessage"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      theme: _signal(null),
      color: _signal(null),
      loading: _signal(null),
      title: _signal(null),
      logMessage: _signal(null)
    };
  }
  attributeChangedCallback(name, _, value) {
    this._propsSignals[name].value = value;
  }
  connectedCallback() {
    this._onMounts = [];
    this._onCleanups = [];
    const props = _createPropsProxy(this);
    _withInstance(this, () => {
      let count = _signal(0);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        _effect(() => el0.className = props.theme);
        _effect(() => Object.assign(el0.style, {
          color: props.color,
          opacity: count.value > 5 ? 1 : 0.5
        }));
        _renderDynamic(el0, () => props.loading ? (() => {
          const el0 = document.createElement("span");
          const text1 = document.createTextNode("Loading...");
          el0.appendChild(text1);
          return el0;
        })() : (() => {
          const el0 = document.createElement("div");
          const el1 = document.createElement("h1");
          _renderDynamic(el1, () => props.title);
          el0.appendChild(el1);
          const el2 = document.createElement("button");
          el2.onclick = () => console.log(props.logMessage);
          const text3 = document.createTextNode("Log ");
          el2.appendChild(text3);
          _renderDynamic(el2, () => count.value);
          el0.appendChild(el2);
          return el0;
        })());
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
customElements.define("waf-complexexpressions", ComplexExpressionsElement);
export default ComplexExpressionsElement;