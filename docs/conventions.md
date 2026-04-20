# File Conventions

## File Types

### `.jsx` / `.tsx`
* **Compiles to**: Imperative DOM render function.
* **Used for**: Pages (entry points for routes).
* **Restrictions**: Cannot be used as JSX components; MUST export a default function.

### `.wc.jsx` / `.wc.tsx`
* **Compiles to**: Web Component (Custom Element).
* **Used for**: Reusable UI components.
* **Compatibility**: Can be imported and used as tags in both `.jsx` and `.wc.jsx` files.
* **Naming**: Will be automatically registered with the `waf-` prefix (e.g., `Button.wc.jsx` -> `<waf-button>`).

### `.js` / `.ts`
* **Used for**: Utilities, business logic, signals, and shared state.

## Rules
* All components MUST export a default function.
* Components MUST follow PascalCase naming (e.g., `Counter`).
* Tag usage of a `.jsx` file as a component is strictly forbidden and will throw a compiler error.

## Lifecycle Hooks
Components support two primary lifecycle hooks that are automatically transformed by the compiler:
* `onMount(() => { ... })`: Runs when the component is added to the DOM.
* `onCleanup(() => { ... })`: Runs when the component is removed from the DOM.

**Note**: You do NOT need to import these functions; the compiler handles them globally within `.wc.jsx` files.
