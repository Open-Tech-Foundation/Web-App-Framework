// Native-DOM test helpers for `esdev test --dom`.
//
// Replaces the happy-dom / testing-library based `@opentf/web-test` render +
// user-event for suites that run under esdev. Interactions use real DOM APIs
// (verified against esdev's --dom realm): focusing + `input` events for typing,
// `.click()` for buttons and checkboxes (fires `input`/`change`), `blur()` for
// tabbing away. Mounted containers are removed after every test.
import { afterEach } from "runtime:test";

const mounted = new Set();

function instantiate(Component, props) {
  if (typeof Component === "function" && Component.prototype instanceof HTMLElement) {
    const tagName =
      Component.tag ?? Component.prototype.tagName?.toLowerCase() ?? Component.name.toLowerCase();
    const element = document.createElement(tagName);
    Object.assign(element, props);
    return element;
  }
  if (typeof Component === "function") {
    const node = Component(props);
    if (node instanceof Node) return node;
    throw new Error("render(): component function did not return a DOM node");
  }
  if (typeof Component === "string") {
    const element = document.createElement(Component);
    Object.assign(element, props);
    return element;
  }
  throw new Error("render(): invalid component type passed to mount()");
}

const ROLE_SELECTORS = {
  listitem: 'li,[role="listitem"]',
  button: 'button,[role="button"]',
  textbox: 'input:not([type]),input[type="text"],[role="textbox"]',
};

export function mount(Component, props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const element = instantiate(Component, props);
  if (element.parentNode !== container) container.appendChild(element);
  mounted.add(container);
  const query = (id) => container.querySelector(`[data-testid="${id}"]`);
  return {
    container,
    element,
    getByTestId(id) {
      const el = query(id);
      if (!el) throw new Error(`getByTestId: no element with data-testid="${id}"`);
      return el;
    },
    queryByTestId(id) {
      return query(id);
    },
    getAllByRole(role) {
      const selector = ROLE_SELECTORS[role];
      if (!selector) throw new Error(`getAllByRole: unsupported role "${role}"`);
      return [...container.querySelectorAll(selector)];
    },
    unmount() {
      container.remove();
      mounted.delete(container);
    },
  };
}

export async function type(input, text) {
  input.focus();
  input.value += text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function clear(input) {
  input.focus();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function click(element) {
  element.click();
}

export async function tab() {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
}

afterEach(() => {
  for (const container of mounted) container.remove();
  mounted.clear();
});
