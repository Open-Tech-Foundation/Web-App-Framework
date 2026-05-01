import { effect, signal } from "@preact/signals-core";
import { IS_PROPERTY } from "../core/constants.js";

function toKebabCase(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

export function createPropsProxy(el) {
  if (!el._propsSignals) el._propsSignals = {};
  
  return new Proxy(el, {
    get: (target, key) => {
      if (key === "__signals") return target._propsSignals;
      if (key === "children") return target._children;
      if (typeof key === "symbol") return target[key];
      if (key === "then") return undefined; // Promise check
      
      if (!target._propsSignals[key]) {
        let val = target.getAttribute(toKebabCase(key)) || target[key];
        // Handle case-insensitivity for events (stored as lowercase by applySpread)
        if (val === undefined && typeof key === "string" && key.toLowerCase().startsWith("on")) {
          val = target[key.toLowerCase()];
        }
        target._propsSignals[key] = signal(val);
      }
      return target._propsSignals[key].value;
    },
    set: (target, key, value) => {
      const isSignal = value && typeof value === "object" && "value" in value && typeof value.subscribe === "function";
      
      if (!target._propsSignals[key]) {
        target._propsSignals[key] = signal(isSignal ? value.value : value);
      }
      
      if (isSignal) {
        // Link the internal signal to the external one
        if (target._propsSignals[key]._link) target._propsSignals[key]._link(); // Cleanup old link
        target._propsSignals[key]._link = effect(() => {
          target._propsSignals[key].value = value.value;
        });
      } else {
        target._propsSignals[key].value = value;
      }
      
      target[key] = value;
      return true;
    },
    ownKeys: (target) => {
      const keys = new Set(Object.keys(target));
      // Include all "on*" properties even if they aren't enumerable (native events)
      for (const key in target) {
        if (key.startsWith("on")) keys.add(key);
      }
      Object.keys(target._propsSignals).forEach(k => keys.add(k));
      keys.add("children");
      return Array.from(keys).filter(k => !k.startsWith("_"));
    },
    getOwnPropertyDescriptor: (target, key) => {
      return {
        enumerable: true,
        configurable: true
      };
    }
  });
}

export function applySpread(el, props) {
  if (!props) return;
  
  const signals = props?.__signals;
  
  Object.keys(props).forEach(key => {
    let value = props[key];
    if (signals && signals[key]) value = signals[key];
    
    const name = key.toLowerCase();
    const attrProp = (name === "class" || name === "classname") ? "className" : key;
    const isProperty = IS_PROPERTY.includes(attrProp);
    const isEvent = name.startsWith("on");

    // Simple heuristic for signal detection: object with .value and .subscribe
    const isSignal = value && typeof value === "object" && "value" in value && typeof value.subscribe === "function";

    if (isSignal) {
      effect(() => {
        const val = value.value;
        if (isProperty) {
          let targetProp = attrProp;
          if (targetProp === "value" && el.type === "checkbox") {
            targetProp = "checked";
          }
          if (targetProp === "style" && val && typeof val === "object") {
            Object.assign(el.style, val);
          } else if (targetProp === "className" && el instanceof SVGElement) {
            el.setAttribute("class", val);
          } else {
            el[targetProp] = val;
          }
        } else {
          if (val === null || val === undefined || val === false) {
            el.removeAttribute(key);
          } else {
            el.setAttribute(key, val);
          }
        }
      });
    } else {
      if (isEvent) {
        el[name] = value;
      } else if (isProperty) {
        let targetProp = attrProp;
        if (targetProp === "value" && el.type === "checkbox") {
          targetProp = "checked";
        }
        if (targetProp === "style" && value && typeof value === "object") {
          Object.assign(el.style, value);
        } else if (targetProp === "className" && el instanceof SVGElement) {
          el.setAttribute("class", value);
        } else {
          el[targetProp] = value;
        }
      } else {
        if (value === null || value === undefined || value === false) {
          el.removeAttribute(key);
        } else {
          el.setAttribute(key, value);
        }
      }
    }
  });
}
