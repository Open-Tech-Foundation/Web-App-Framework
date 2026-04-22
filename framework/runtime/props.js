import { effect } from "@preact/signals-core";

export function createPropsProxy(instance) {
  return new Proxy({}, {
    get(_, key) {
      if (key === "__signals") return instance._propsSignals;
      if (key === "children") return instance._children;
      if (instance._propsSignals[key]) return instance._propsSignals[key].value;
      return instance[key];
    },
    ownKeys(_) {
      const keys = new Set([
        ...Object.keys(instance._propsSignals),
        ...Object.keys(instance).filter(k => !k.startsWith('_')),
        "children"
      ]);
      return Array.from(keys);
    },
    getOwnPropertyDescriptor(target, key) {
      return {
        enumerable: true,
        configurable: true,
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
    const isProperty = ["className", "style", "value", "checked", "id", "title", "href", "src", "key"].includes(attrProp);
    const isEvent = name.startsWith("on");

    // Simple heuristic for signal detection: object with .value and .subscribe
    const isSignal = value && typeof value === "object" && "value" in value && typeof value.subscribe === "function";

    if (isSignal) {
      effect(() => {
        const val = value.value;
        if (isProperty) {
          if (attrProp === "style" && val && typeof val === "object") {
            Object.assign(el.style, val);
          } else if (attrProp === "className" && el instanceof SVGElement) {
            el.setAttribute("class", val);
          } else {
            el[attrProp] = val;
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
        if (attrProp === "style" && value && typeof value === "object") {
          Object.assign(el.style, value);
        } else if (attrProp === "className" && el instanceof SVGElement) {
          el.setAttribute("class", value);
        } else {
          el[attrProp] = value;
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
