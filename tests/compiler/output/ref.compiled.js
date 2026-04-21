import { withInstance as _withInstance } from "/framework/runtime/lifecycle.js";
import { createPropsProxy as _createPropsProxy } from "/framework/runtime/props.js";
import { effect as _effect } from "@preact/signals-core";
import { onMount as _onMount } from "/framework/runtime/lifecycle.js";
import { signal as _signal } from "@preact/signals-core";
class CustomInputElement extends HTMLElement {
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
      const input = _signal();
      const focus = () => input.value.focus();
      Object.assign(this, {
        focus
      });
      const rootElement = (() => {
        const el0 = document.createElement("input");
        input.value = el0;
        el0.setAttribute("type", "text");
        el0.setAttribute("placeholder", "Custom Input");
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
customElements.define("waf-custominput", CustomInputElement);
class RefTestElement extends HTMLElement {
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
      const myDiv = _signal();
      const myInput = _signal();
      let color = _signal("red");
      _onMount(() => {
        myDiv.value.style.backgroundColor = "lightgray";
        myInput.value.focus();
      });
      const rootElement = (() => {
        const el0 = document.createElement("div");
        myDiv.value = el0;
        _effect(() => Object.assign(el0.style, {
          padding: "20px"
        }));
        const el1 = document.createElement("h1");
        _effect(() => Object.assign(el1.style, {
          color: color.value
        }));
        const text2 = document.createTextNode("Ref Test");
        el1.appendChild(text2);
        el0.appendChild(el1);
        const el3 = document.createElement("waf-custominput");
        myInput.value = el3;
        el0.appendChild(el3);
        const el4 = document.createElement("button");
        el4.onclick = () => color.value = "blue";
        const text5 = document.createTextNode("Change Color");
        el4.appendChild(text5);
        el0.appendChild(el4);
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
customElements.define("waf-reftest", RefTestElement);
export default RefTestElement;