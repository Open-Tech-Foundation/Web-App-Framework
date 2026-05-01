import { computed as _computed, renderDynamic as _renderDynamic, effect as _effect, applySpread as _applySpread, _mapped, signal as _signal, createPropsProxy as _createPropsProxy, withInstance as _withInstance } from "@opentf/web";
import { z } from "zod";
import { createForm } from "@opentf/web-form";
import { zodResolver } from "./zodResolver.js";

/**
 * A custom form field component that works with 'register' props.
 */
export class FormField extends HTMLElement {
  static observedAttributes = ["value"];
  set value(val) {
    this._propsSignals["value"].value = val;
  }
  get value() {
    return this._propsSignals["value"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      value: _signal(null)
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
      const {
        label,
        name,
        form,
        ...rest
      } = props;
      const error = _computed(() => form.errors[name] && form.touched[name] ? form.errors[name] : null);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "flex flex-col gap-1.5 mb-5 group";
        const el1 = document.createElement("label");
        el1.className = "text-xs font-bold text-slate-400 uppercase tracking-wider ml-1 group-focus-within:text-blue-400 transition-colors";
        _renderDynamic(el1, () => label);
        el0.appendChild(el1);
        const el2 = document.createElement("input");
        _effect(() => el2.setAttribute("name", name));
        _applySpread(el2, rest);
        _effect(() => el2.value = props.value);
        el2.oninput = props.onInput;
        el2.onblur = props.onBlur;
        _effect(() => el2.className = error.value ? 'px-4 py-3 rounded-xl border transition-all duration-300 outline-none bg-red-500/5 border-red-500/50 text-white placeholder-slate-500 backdrop-blur-sm shadow-[0_0_15px_-3px_rgba(239,68,68,0.2)]' : 'px-4 py-3 rounded-xl border transition-all duration-300 outline-none bg-slate-900/50 border-slate-700/50 text-white placeholder-slate-500 backdrop-blur-sm focus:border-blue-500/50 focus:bg-slate-900/80 focus:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]');
        el0.appendChild(el2);
        const el3 = document.createElement("div");
        el3.className = "h-4 ml-1";
        _renderDynamic(el3, () => () => error.value && (() => {
          const el0 = document.createElement("span");
          el0.className = "text-[10px] text-red-400 font-bold flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200";
          const el1 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          el1.setAttribute("class", "w-3 h-3");
          el1.setAttribute("fill", "currentColor");
          el1.setAttribute("viewBox", "0 0 20 20");
          const el2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
          el2.setAttribute("fill-rule", "evenodd");
          el2.setAttribute("d", "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z");
          el2.setAttribute("clip-rule", "evenodd");
          el1.appendChild(el2);
          el0.appendChild(el1);
          _renderDynamic(el0, () => error.value);
          return el0;
        })());
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
/**
 * A custom toggle/checkbox component.
 */
customElements.define("web-formfield", FormField);
export class CustomToggle extends HTMLElement {
  static observedAttributes = ["label", "value"];
  set label(val) {
    this._propsSignals["label"].value = val;
  }
  set value(val) {
    this._propsSignals["value"].value = val;
  }
  get label() {
    return this._propsSignals["label"].value;
  }
  get value() {
    return this._propsSignals["value"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      label: _signal(null),
      value: _signal(null)
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
      const toggle = () => {
        props.onInput({
          target: {
            checked: !props.value,
            type: 'checkbox'
          }
        });
      };
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "flex items-center justify-between p-4 rounded-xl border border-slate-700/30 bg-slate-900/20 mb-6 cursor-pointer hover:bg-slate-900/40 transition-all group";
        el0.onclick = toggle;
        const el1 = document.createElement("span");
        el1.className = "text-sm font-medium text-slate-300 group-hover:text-white transition-colors";
        _renderDynamic(el1, () => props.label);
        el0.appendChild(el1);
        const el2 = document.createElement("div");
        _effect(() => el2.className = props.value ? 'w-12 h-6 rounded-full transition-all duration-500 relative p-1 bg-emerald-500 shadow-[0_0_15px_-3px_rgba(16,185,129,0.5)]' : 'w-12 h-6 rounded-full transition-all duration-500 relative p-1 bg-slate-700');
        const el3 = document.createElement("div");
        _effect(() => el3.className = props.value ? 'w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-lg transform translate-x-6' : 'w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-lg transform translate-x-0');
        el2.appendChild(el3);
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
customElements.define("web-customtoggle", CustomToggle);
export class FormStatus extends HTMLElement {
  static observedAttributes = ["form"];
  set form(val) {
    this._propsSignals["form"].value = val;
  }
  get form() {
    return this._propsSignals["form"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      form: _signal(null)
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
      const isValid = _computed(() => props.form.isValid);
      const isChanged = _computed(() => props.form.isChanged);
      const isTouched = _computed(() => props.form.isTouched);
      const isSubmitting = _computed(() => props.form.isSubmitting);
      const rootElement = (() => {
        const el0 = document.createElement("div");
        el0.className = "grid grid-cols-2 md:grid-cols-4 gap-3 mb-8";
        const el1 = document.createElement("div");
        _effect(() => el1.className = isValid.value ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500');
        const el2 = document.createElement("span");
        el2.className = "text-[10px] font-black uppercase tracking-widest";
        _renderDynamic(el2, () => isValid.value ? "Valid" : "Invalid");
        el1.appendChild(el2);
        el0.appendChild(el1);
        const el3 = document.createElement("div");
        _effect(() => el3.className = isChanged.value ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_-5px_rgba(59,130,246,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500');
        const el4 = document.createElement("span");
        el4.className = "text-[10px] font-black uppercase tracking-widest";
        _renderDynamic(el4, () => isChanged.value ? "Changed" : "Clean");
        el3.appendChild(el4);
        el0.appendChild(el3);
        const el5 = document.createElement("div");
        _effect(() => el5.className = isTouched.value ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_-5px_rgba(245,158,11,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500');
        const el6 = document.createElement("span");
        el6.className = "text-[10px] font-black uppercase tracking-widest";
        _renderDynamic(el6, () => () => isTouched.value ? "Touched" : "Untouched");
        el5.appendChild(el6);
        el0.appendChild(el5);
        const el7 = document.createElement("div");
        _effect(() => el7.className = isSubmitting.value ? 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_15px_-5px_rgba(168,85,247,0.3)]' : 'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all duration-500 bg-slate-800/20 border-slate-700/30 text-slate-500');
        const el8 = document.createElement("span");
        el8.className = "text-[10px] font-black uppercase tracking-widest";
        _renderDynamic(el8, () => () => isSubmitting.value ? "Saving" : "Idle");
        el7.appendChild(el8);
        el0.appendChild(el7);
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
customElements.define("web-formstatus", FormStatus);
export class ModeSelector extends HTMLElement {
  static observedAttributes = ["label", "value", "options", "onchange"];
  set label(val) {
    this._propsSignals["label"].value = val;
  }
  set value(val) {
    this._propsSignals["value"].value = val;
  }
  set options(val) {
    this._propsSignals["options"].value = val;
  }
  set onchange(val) {
    this._propsSignals["onchange"].value = val;
  }
  get label() {
    return this._propsSignals["label"].value;
  }
  get value() {
    return this._propsSignals["value"].value;
  }
  get options() {
    return this._propsSignals["options"].value;
  }
  get onchange() {
    return this._propsSignals["onchange"].value;
  }
  constructor() {
    super();
    this._propsSignals = {
      label: _signal(null),
      value: _signal(null),
      options: _signal(null),
      onchange: _signal(null)
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
        const el0 = document.createElement("div");
        el0.className = "flex flex-col gap-1.5 min-w-[100px]";
        const el1 = document.createElement("label");
        el1.className = "text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1";
        _renderDynamic(el1, () => props.label);
        el0.appendChild(el1);
        const el2 = document.createElement("div");
        el2.className = "relative group";
        const el3 = document.createElement("select");
        _effect(() => el3.value = props.value);
        el3.onchange = e => props.onchange(e.target.value);
        el3.className = "appearance-none w-full bg-slate-900/80 border border-slate-700/50 text-slate-200 text-[11px] font-bold rounded-lg px-3 py-1.5 outline-none focus:border-blue-500/50 transition-all cursor-pointer pr-8";
        const mapped4 = _mapped(() => props.options, opt => (() => {
          const el0 = document.createElement("option");
          _effect(() => el0.value = opt.value);
          _renderDynamic(el0, () => opt.value);
          return el0;
        })());
        _renderDynamic(el3, () => mapped4());
        el2.appendChild(el3);
        const el5 = document.createElement("div");
        el5.className = "absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-500 group-hover:text-blue-400 transition-colors";
        const el6 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el6.setAttribute("class", "w-4 h-4");
        el6.setAttribute("fill", "currentColor");
        el6.setAttribute("viewBox", "0 0 20 20");
        const el7 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el7.setAttribute("fill-rule", "evenodd");
        el7.setAttribute("d", "M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z");
        el7.setAttribute("clip-rule", "evenodd");
        el6.appendChild(el7);
        el5.appendChild(el6);
        el2.appendChild(el5);
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
customElements.define("web-modeselector", ModeSelector);
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
      const mode = _signal("onBlur");
      const reValidateMode = _signal("onChange");
      const schema = z.object({
        username: z.string().min(3, "Username must be at least 3 chars"),
        email: z.string().email("Invalid email address")
      });
      const form = createForm({
        initialValues: {
          username: "",
          email: ""
        },
        validator: zodResolver(schema),
        mode: mode.value,
        reValidateMode: reValidateMode.value
      });
      const isValid = _computed(() => form.isValid);
      const isChanged = _computed(() => form.isChanged);
      const isSubmitting = _computed(() => form.isSubmitting);
      const isSubmitted = _computed(() => form.isSubmitted);
      const canSubmit = _computed(() => isValid.value && !isSubmitting.value);
      const rootElement = (() => {
        const el0 = document.createElement("section");
        el0._key = mode.value + reValidateMode.value;
        el0.className = "bg-slate-800/40 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]";
        const el1 = document.createElement("div");
        el1.className = "flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10";
        const el2 = document.createElement("div");
        el2.className = "flex items-center gap-4";
        const el3 = document.createElement("div");
        el3.className = "p-3 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/20 text-blue-400 shadow-lg shadow-blue-500/10";
        const el4 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el4.setAttribute("class", "w-7 h-7");
        el4.setAttribute("fill", "none");
        el4.setAttribute("stroke", "currentColor");
        el4.setAttribute("viewBox", "0 0 24 24");
        const el5 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el5.setAttribute("stroke-linecap", "round");
        el5.setAttribute("stroke-linejoin", "round");
        el5.setAttribute("stroke-width", "2");
        el5.setAttribute("d", "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z");
        el4.appendChild(el5);
        el3.appendChild(el4);
        el2.appendChild(el3);
        const el6 = document.createElement("div");
        const el7 = document.createElement("h2");
        el7.className = "text-2xl font-black text-white tracking-tight leading-tight";
        const text8 = document.createTextNode("Basic Account");
        el7.appendChild(text8);
        el6.appendChild(el7);
        const el9 = document.createElement("p");
        el9.className = "text-slate-500 text-xs font-medium tracking-wide";
        const text10 = document.createTextNode("Enter your core credentials");
        el9.appendChild(text10);
        el6.appendChild(el9);
        el2.appendChild(el6);
        el1.appendChild(el2);
        const el11 = document.createElement("div");
        el11.className = "flex gap-3 bg-slate-900/40 p-2 rounded-2xl border border-slate-700/30";
        const el12 = document.createElement("web-modeselector");
        el12.label = "Mode";
        _effect(() => el12.value = mode.value);
        _effect(() => el12.options = ["onBlur", "onChange", "onTouched", "onSubmit"]);
        _effect(() => el12.onchange = v => mode.value = v);
        el11.appendChild(el12);
        const el13 = document.createElement("web-modeselector");
        el13.label = "Re-Validate";
        _effect(() => el13.value = reValidateMode.value);
        _effect(() => el13.options = ["onChange", "onBlur", "onSubmit"]);
        _effect(() => el13.onchange = v => reValidateMode.value = v);
        el11.appendChild(el13);
        el1.appendChild(el11);
        el0.appendChild(el1);
        const el14 = document.createElement("web-formstatus");
        _effect(() => el14.form = form);
        el0.appendChild(el14);
        const el15 = document.createElement("form");
        el15.onsubmit = form.handleSubmit(async v => {
          await new Promise(r => setTimeout(r, 1500));
          console.log('Submitted:', v);
        });
        const el16 = document.createElement("web-formfield");
        el16.label = "Username";
        el16.name = "username";
        _effect(() => el16.form = form);
        _applySpread(el16, form.register('username'));
        el15.appendChild(el16);
        const el17 = document.createElement("web-formfield");
        el17.label = "Email";
        el17.name = "email";
        _effect(() => el17.form = form);
        _applySpread(el17, form.register('email'));
        el15.appendChild(el17);
        const el18 = document.createElement("div");
        el18.className = "flex gap-4 mt-8";
        const el19 = document.createElement("button");
        el19.setAttribute("type", "button");
        el19.onclick = () => form.reset();
        el19.className = "flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold tracking-wide uppercase text-[11px]";
        const text20 = document.createTextNode("Reset");
        el19.appendChild(text20);
        el18.appendChild(el19);
        const el21 = document.createElement("button");
        el21.setAttribute("type", "submit");
        _effect(() => el21.disabled = !canSubmit.value);
        _effect(() => el21.className = canSubmit.value ? 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-blue-600 hover:bg-blue-500 shadow-blue-600/20 scale-100 hover:scale-[1.02] active:scale-[0.98]' : 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-slate-700 text-slate-500 opacity-50 cursor-not-allowed grayscale');
        _renderDynamic(el21, () => isSubmitting.value ? "Processing..." : "Save Changes");
        el18.appendChild(el21);
        el15.appendChild(el18);
        _renderDynamic(el15, () => isSubmitted.value && (() => {
          const el0 = document.createElement("div");
          el0.className = "mt-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center text-xs font-bold text-emerald-400 animate-in fade-in zoom-in duration-300";
          const text1 = document.createTextNode(" \u2728 Changes saved successfully! ");
          el0.appendChild(text1);
          return el0;
        })());
        el0.appendChild(el15);
        const el22 = document.createElement("div");
        el22.className = "mt-10 pt-8 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-2 gap-6";
        const el23 = document.createElement("div");
        const el24 = document.createElement("div");
        el24.className = "flex items-center gap-2 mb-3 ml-1";
        const el25 = document.createElement("div");
        el25.className = "w-1.5 h-1.5 rounded-full bg-blue-500";
        el24.appendChild(el25);
        const el26 = document.createElement("p");
        el26.className = "text-[10px] font-black uppercase tracking-widest text-slate-500";
        const text27 = document.createTextNode("Form Values");
        el26.appendChild(text27);
        el24.appendChild(el26);
        el23.appendChild(el24);
        const el28 = document.createElement("pre");
        el28.className = "text-[11px] font-mono bg-slate-950/80 p-4 rounded-2xl border border-slate-800/50 text-blue-300/80 overflow-auto max-h-48 leading-relaxed shadow-inner";
        _renderDynamic(el28, () => () => JSON.stringify(form.values, null, 2));
        el23.appendChild(el28);
        el22.appendChild(el23);
        const el29 = document.createElement("div");
        const el30 = document.createElement("div");
        el30.className = "flex items-center gap-2 mb-3 ml-1";
        const el31 = document.createElement("div");
        el31.className = "w-1.5 h-1.5 rounded-full bg-amber-500";
        el30.appendChild(el31);
        const el32 = document.createElement("p");
        el32.className = "text-[10px] font-black uppercase tracking-widest text-slate-500";
        const text33 = document.createTextNode("Internal State");
        el32.appendChild(text33);
        el30.appendChild(el32);
        el29.appendChild(el30);
        const el34 = document.createElement("pre");
        el34.className = "text-[11px] font-mono bg-slate-950/80 p-4 rounded-2xl border border-slate-800/50 text-amber-300/80 overflow-auto max-h-48 leading-relaxed shadow-inner";
        _renderDynamic(el34, () => JSON.stringify({
          touched: form.touched,
          errors: form.errors
        }, null, 2));
        el29.appendChild(el34);
        el22.appendChild(el29);
        el0.appendChild(el22);
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
export class ComplexForm extends HTMLElement {
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
      const mode = _signal("onBlur");
      const reValidateMode = _signal("onChange");
      const schema = z.object({
        profile: z.object({
          firstName: z.string().min(1, "First name is required"),
          lastName: z.string().min(1, "Last name is required")
        }),
        preferences: z.object({
          newsletter: z.boolean()
        })
      });
      const form = createForm({
        initialValues: {
          profile: {
            firstName: "",
            lastName: ""
          },
          preferences: {
            newsletter: true
          }
        },
        validator: zodResolver(schema),
        mode: mode.value,
        reValidateMode: reValidateMode.value
      });
      const isValid = _computed(() => form.isValid);
      const isChanged = _computed(() => form.isChanged);
      const isSubmitting = _computed(() => form.isSubmitting);
      const isSubmitted = _computed(() => form.isSubmitted);
      const canSubmit = _computed(() => isValid.value && !isSubmitting.value);
      const rootElement = (() => {
        const el0 = document.createElement("section");
        el0._key = mode.value + reValidateMode.value;
        el0.className = "bg-slate-800/40 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/50 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]";
        const el1 = document.createElement("div");
        el1.className = "flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10";
        const el2 = document.createElement("div");
        el2.className = "flex items-center gap-4";
        const el3 = document.createElement("div");
        el3.className = "p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-500/20 text-purple-400 shadow-lg shadow-purple-500/10";
        const el4 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el4.setAttribute("class", "w-7 h-7");
        el4.setAttribute("fill", "none");
        el4.setAttribute("stroke", "currentColor");
        el4.setAttribute("viewBox", "0 0 24 24");
        const el5 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el5.setAttribute("stroke-linecap", "round");
        el5.setAttribute("stroke-linejoin", "round");
        el5.setAttribute("stroke-width", "2");
        el5.setAttribute("d", "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4");
        el4.appendChild(el5);
        el3.appendChild(el4);
        el2.appendChild(el3);
        const el6 = document.createElement("div");
        const el7 = document.createElement("h2");
        el7.className = "text-2xl font-black text-white tracking-tight leading-tight";
        const text8 = document.createTextNode("Advanced Profile");
        el7.appendChild(text8);
        el6.appendChild(el7);
        const el9 = document.createElement("p");
        el9.className = "text-slate-500 text-xs font-medium tracking-wide";
        const text10 = document.createTextNode("Nested data & preferences");
        el9.appendChild(text10);
        el6.appendChild(el9);
        el2.appendChild(el6);
        el1.appendChild(el2);
        const el11 = document.createElement("div");
        el11.className = "flex gap-3 bg-slate-900/40 p-2 rounded-2xl border border-slate-700/30";
        const el12 = document.createElement("web-modeselector");
        el12.label = "Mode";
        _effect(() => el12.value = mode.value);
        _effect(() => el12.options = ["onBlur", "onChange", "onTouched", "onSubmit"]);
        _effect(() => el12.onchange = v => mode.value = v);
        el11.appendChild(el12);
        const el13 = document.createElement("web-modeselector");
        el13.label = "Re-Validate";
        _effect(() => el13.value = reValidateMode.value);
        _effect(() => el13.options = ["onChange", "onBlur", "onSubmit"]);
        _effect(() => el13.onchange = v => reValidateMode.value = v);
        el11.appendChild(el13);
        el1.appendChild(el11);
        el0.appendChild(el1);
        const el14 = document.createElement("web-formstatus");
        _effect(() => el14.form = form);
        el0.appendChild(el14);
        const el15 = document.createElement("form");
        el15.onsubmit = form.handleSubmit(async v => {
          await new Promise(r => setTimeout(r, 1500));
          console.log('Submitted Profile:', v);
        });
        const el16 = document.createElement("div");
        el16.className = "grid grid-cols-1 md:grid-cols-2 gap-4";
        const el17 = document.createElement("web-formfield");
        el17.label = "First Name";
        el17.name = "profile.firstName";
        _effect(() => el17.form = form);
        _applySpread(el17, form.register('profile.firstName'));
        el16.appendChild(el17);
        const el18 = document.createElement("web-formfield");
        el18.label = "Last Name";
        el18.name = "profile.lastName";
        _effect(() => el18.form = form);
        _applySpread(el18, form.register('profile.lastName'));
        el16.appendChild(el18);
        el15.appendChild(el16);
        const el19 = document.createElement("web-customtoggle");
        el19.label = "Subscribe to developer updates";
        _applySpread(el19, form.register("preferences.newsletter"));
        el15.appendChild(el19);
        const el20 = document.createElement("div");
        el20.className = "flex gap-4 mt-8";
        const el21 = document.createElement("button");
        el21.setAttribute("type", "button");
        el21.onclick = () => form.reset();
        el21.className = "flex-1 py-3.5 border border-slate-700 text-slate-400 rounded-xl hover:bg-slate-700/30 hover:text-white transition-all font-bold tracking-wide uppercase text-[11px]";
        const text22 = document.createTextNode("Reset");
        el21.appendChild(text22);
        el20.appendChild(el21);
        const el23 = document.createElement("button");
        el23.setAttribute("type", "submit");
        _effect(() => el23.disabled = !canSubmit.value);
        _effect(() => el23.className = canSubmit.value ? 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-purple-600 hover:bg-purple-700 shadow-purple-600/20 scale-100 hover:scale-[1.02] active:scale-[0.98]' : 'flex-[2] py-3.5 text-white rounded-xl transition-all duration-500 font-bold tracking-wide uppercase text-[11px] shadow-xl bg-slate-700 text-slate-500 opacity-50 cursor-not-allowed grayscale');
        _renderDynamic(el23, () => isSubmitting.value ? "Processing..." : "Submit Profile");
        el20.appendChild(el23);
        el15.appendChild(el20);
        _renderDynamic(el15, () => isSubmitted.value && (() => {
          const el0 = document.createElement("div");
          el0.className = "mt-6 p-3 rounded-xl bg-purple-500/10 border border-emerald-500/20 text-center text-xs font-bold text-purple-400 animate-in fade-in zoom-in duration-300";
          const text1 = document.createTextNode(" \u2728 Profile updated successfully! ");
          el0.appendChild(text1);
          return el0;
        })());
        el0.appendChild(el15);
        const el24 = document.createElement("div");
        el24.className = "mt-10 pt-8 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-2 gap-6";
        const el25 = document.createElement("div");
        const el26 = document.createElement("div");
        el26.className = "flex items-center gap-2 mb-3 ml-1";
        const el27 = document.createElement("div");
        el27.className = "w-1.5 h-1.5 rounded-full bg-purple-500";
        el26.appendChild(el27);
        const el28 = document.createElement("p");
        el28.className = "text-[10px] font-black uppercase tracking-widest text-slate-500";
        const text29 = document.createTextNode("Form Values");
        el28.appendChild(text29);
        el26.appendChild(el28);
        el25.appendChild(el26);
        const el30 = document.createElement("pre");
        el30.className = "text-[11px] font-mono bg-slate-950/80 p-4 rounded-2xl border border-slate-800/50 text-purple-300/80 overflow-auto max-h-48 leading-relaxed shadow-inner";
        _renderDynamic(el30, () => JSON.stringify(form.values, null, 2));
        el25.appendChild(el30);
        el24.appendChild(el25);
        const el31 = document.createElement("div");
        const el32 = document.createElement("div");
        el32.className = "flex items-center gap-2 mb-3 ml-1";
        const el33 = document.createElement("div");
        el33.className = "w-1.5 h-1.5 rounded-full bg-amber-500";
        el32.appendChild(el33);
        const el34 = document.createElement("p");
        el34.className = "text-[10px] font-black uppercase tracking-widest text-slate-500";
        const text35 = document.createTextNode("Internal State");
        el34.appendChild(text35);
        el32.appendChild(el34);
        el31.appendChild(el32);
        const el36 = document.createElement("pre");
        el36.className = "text-[11px] font-mono bg-slate-950/80 p-4 rounded-2xl border border-slate-800/50 text-amber-300/80 overflow-auto max-h-48 leading-relaxed shadow-inner";
        _renderDynamic(el36, () => () => JSON.stringify({
          touched: form.touched,
          errors: form.errors
        }, null, 2));
        el31.appendChild(el36);
        el24.appendChild(el31);
        el0.appendChild(el24);
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
customElements.define("web-complexform", ComplexForm);
