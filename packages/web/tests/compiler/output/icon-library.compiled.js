import { effect as _effect, applySpread as _applySpread, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
class IconGalleryElement extends HTMLElement {
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
        el0.className = "flex gap-4";
        const el1 = document.createElement("web-cameraicon");
        _effect(() => el1.size = 32);
        el1.color = "red";
        el0.appendChild(el1);
        const el2 = document.createElement("web-usericon");
        _effect(() => el2.size = 24);
        el2.className = "text-blue-500";
        el0.appendChild(el2);
        const el3 = document.createElement("web-settingsicon");
        _effect(() => el3.strokeWidth = 3);
        el0.appendChild(el3);
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
customElements.define("web-icongallery", IconGalleryElement);
export default IconGalleryElement;
class CameraIconElement extends HTMLElement {
  static observedAttributes = ["size", "color"];
  set size(val) {
    this._propsSignals["size"].value = val;
  }
  set color(val) {
    this._propsSignals["color"].value = val;
  }
  get size() {
    return this._propsSignals["size"].value;
  }
  get color() {
    return this._propsSignals["color"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      size: _signal(null),
      color: _signal(null)
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
      const rootElement = (() => {
        const el0 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el0.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        _effect(() => el0.setAttribute("width", props.size));
        _effect(() => el0.setAttribute("height", props.size));
        el0.setAttribute("viewBox", "0 0 24 24");
        el0.setAttribute("fill", "none");
        _effect(() => el0.setAttribute("stroke", props.color));
        el0.setAttribute("strokeWidth", "2");
        el0.setAttribute("strokeLinecap", "round");
        el0.setAttribute("strokeLinejoin", "round");
        _effect(() => _applySpread(el0, props));
        const el1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el1.setAttribute("d", "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z");
        el0.appendChild(el1);
        const el2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el2.setAttribute("cx", "12");
        el2.setAttribute("cy", "13");
        el2.setAttribute("r", "4");
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
customElements.define("web-cameraicon", CameraIconElement);
class UserIconElement extends HTMLElement {
  static observedAttributes = ["size"];
  set size(val) {
    this._propsSignals["size"].value = val;
  }
  get size() {
    return this._propsSignals["size"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      size: _signal(null)
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
      const rootElement = (() => {
        const el0 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el0.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        _effect(() => el0.setAttribute("width", props.size));
        _effect(() => el0.setAttribute("height", props.size));
        el0.setAttribute("viewBox", "0 0 24 24");
        el0.setAttribute("fill", "none");
        el0.setAttribute("stroke", "currentColor");
        el0.setAttribute("strokeWidth", "2");
        el0.setAttribute("strokeLinecap", "round");
        el0.setAttribute("strokeLinejoin", "round");
        _effect(() => _applySpread(el0, props));
        const el1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el1.setAttribute("d", "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2");
        el0.appendChild(el1);
        const el2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el2.setAttribute("cx", "12");
        el2.setAttribute("cy", "7");
        el2.setAttribute("r", "4");
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
customElements.define("web-usericon", UserIconElement);
class SettingsIconElement extends HTMLElement {
  static observedAttributes = ["strokeWidth"];
  set strokeWidth(val) {
    this._propsSignals["strokeWidth"].value = val;
  }
  get strokeWidth() {
    return this._propsSignals["strokeWidth"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      strokeWidth: _signal(null)
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
      const rootElement = (() => {
        const el0 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el0.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        el0.setAttribute("width", "24");
        el0.setAttribute("height", "24");
        el0.setAttribute("viewBox", "0 0 24 24");
        el0.setAttribute("fill", "none");
        el0.setAttribute("stroke", "currentColor");
        _effect(() => el0.setAttribute("strokeWidth", props.strokeWidth));
        el0.setAttribute("strokeLinecap", "round");
        el0.setAttribute("strokeLinejoin", "round");
        _effect(() => _applySpread(el0, props));
        const el1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el1.setAttribute("cx", "12");
        el1.setAttribute("cy", "12");
        el1.setAttribute("r", "3");
        el0.appendChild(el1);
        const el2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el2.setAttribute("d", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z");
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
customElements.define("web-settingsicon", SettingsIconElement);