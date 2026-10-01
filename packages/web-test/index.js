import { queries, getQueriesForElement } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { mount, runCleanup } from '@opentf/web/runtime';

const mountedComponents = new Map();

/** Mount a registered component, page factory, or tag and bind DOM queries to it. */
export function render(Component, props = {}) {
  if (typeof document === 'undefined') {
    throw new Error('render() requires esdev test --dom (or --browser)');
  }
  const container = document.createElement('div');
  let dispose = () => {};
  try {
    if (typeof Component === 'string' ||
        (typeof Component === 'function' && Component.prototype instanceof HTMLElement)) {
      const tag = typeof Component === 'string' ? Component : Component.tag;
      if (!tag) throw new Error('render(): custom element must expose its registered .tag');
      const element = document.createElement(tag);
      Object.assign(element, props);
      container.appendChild(element);
      document.body.appendChild(container);
    } else if (typeof Component === 'function') {
      // Factory pages need the same reactive scope and lifecycle as app mounting.
      document.body.appendChild(container);
      let element;
      mount(() => {
        element = Component(props);
        if (!(element instanceof Node)) throw new Error('render(): component function must return a DOM node');
        return element;
      }, container);
      dispose = () => runCleanup(element);
    } else {
      throw new Error('render(): invalid component type');
    }
  } catch (error) {
    container.remove();
    throw error;
  }
  const unmount = () => {
    if (!mountedComponents.has(container)) return;
    mountedComponents.delete(container);
    try { dispose(); } finally { container.remove(); }
  };
  mountedComponents.set(container, unmount);
  return { container, unmount, ...getQueriesForElement(container, queries) };
}

export { userEvent };

/**
 * Cleans up all mounted components. Automatically called after each test if supported.
 */
export function cleanup() {
  for (const unmount of [...mountedComponents.values()]) unmount();
}
