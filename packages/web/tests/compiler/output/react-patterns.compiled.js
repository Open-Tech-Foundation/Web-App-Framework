import { effect as _effect, renderDynamic as _renderDynamic, applySpread as _applySpread, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
import { UI } from './ui-lib';
class ReactPatternsElement extends HTMLElement {
  static observedAttributes = ["user", "notifications"];
  set user(val) {
    this._propsSignals["user"].value = val;
  }
  set notifications(val) {
    this._propsSignals["notifications"].value = val;
  }
  get user() {
    return this._propsSignals["user"].value;
  }
  get notifications() {
    return this._propsSignals["notifications"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      user: _signal(null),
      notifications: _signal(null)
    };
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
      const Tag = props.isHeader ? 'h1' : 'h2';
      const items = ['A', 'B'];
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "container";
        el0.setAttribute("data-testid", "main-div");
        const el1 = document.createElement("input");
        el1.disabled = true;
        _effect(() => el1.setAttribute("tab-index", -1));
        _effect(() => el1.setAttribute("max-length", 5));
        el0.appendChild(el1);
        const el2 = document.createElement(Tag);
        const text3 = document.createTextNode("Dynamic Heading");
        el2.appendChild(text3);
        el0.appendChild(el2);
        const el4 = document.createElement("web-ui-button");
        el4.variant = "primary";
        const text5 = document.createTextNode("Click Me");
        el4.appendChild(text5);
        el0.appendChild(el4);
        const el6 = document.createElement("p");
        const text7 = document.createTextNode(" Welcome, ");
        el6.appendChild(text7);
        const el8 = document.createElement("strong");
        _renderDynamic(el8, () => props.user.name);
        el6.appendChild(el8);
        const text9 = document.createTextNode("!  You have ");
        el6.appendChild(text9);
        _renderDynamic(el6, () => props.notifications.length);
        const text10 = document.createTextNode(" new messages. ");
        el6.appendChild(text10);
        el0.appendChild(el6);
        const el11 = document.createElement("div");
        _effect(() => _applySpread(el11, props.extra));
        el11.className = "override";
        el11.id = "constant";
        const text12 = document.createTextNode(" Spread Test ");
        el11.appendChild(text12);
        el0.appendChild(el11);
        const el13 = document.createElement("ul");
        _renderDynamic(el13, () => [(() => {
          const el0 = document.createElement("li");
          el0._key = "1";
          const text1 = document.createTextNode("One");
          el0.appendChild(text1);
          return el0;
        })(), (() => {
          const el0 = document.createElement("li");
          el0._key = "2";
          const text1 = document.createTextNode("Two");
          el0.appendChild(text1);
          return el0;
        })()]);
        el0.appendChild(el13);
        const el14 = document.createElement("web-dataprovider");
        _renderDynamic(el14, () => data => (() => {
          const el0 = document.createElement("div");
          const text1 = document.createTextNode("Data: ");
          el0.appendChild(text1);
          _renderDynamic(el0, () => data.value);
          return el0;
        })());
        el0.appendChild(el14);
        const el15 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el15.setAttribute("viewBox", "0 0 100 100");
        el15.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const el16 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el16.setAttribute("cx", "50");
        el16.setAttribute("cy", "50");
        el16.setAttribute("r", "40");
        el16.setAttribute("strokeWidth", "2");
        el16.setAttribute("fill", "red");
        el15.appendChild(el16);
        el0.appendChild(el15);
        const el17 = document.createElement("web-customcomponent");
        el0.appendChild(el17);
        const el18 = document.createElement("br");
        el0.appendChild(el18);
        const el19 = document.createElement("hr");
        el0.appendChild(el19);
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
customElements.define("web-reactpatterns", ReactPatternsElement);
export default ReactPatternsElement;
function DataProvider({
  children
}) {
  const data = {
    value: 'Secret'
  };
  return typeof children === 'function' ? children(data) : children;
}
class CustomComponentElement extends HTMLElement {
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
      const rootElement = (() => {
        const el0 = document.createElement("div");
        const text1 = document.createTextNode("Custom");
        el0.appendChild(text1);
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
customElements.define("web-customcomponent", CustomComponentElement);