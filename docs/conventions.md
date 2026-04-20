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
* **CSS Classes**: You may use either `class` or `className` in your JSX. The compiler automatically maps both to the native `className` property.
* **Inline Styles**: Supports React-style style objects: `style={{ display: 'flex', gap: '10px' }}`.
* **SVG/Attributes**: Supports camelCase attributes (e.g., `strokeWidth`) which are automatically mapped to their kebab-case versions in the DOM.
* **Comments**: Standard JSX comments `{/* ... */}` are supported. If using single-line comments `{ // ... }`, ensure the closing brace is on a new line to avoid syntax errors.
* Tag usage of a `.jsx` file as a component is strictly forbidden and will throw a compiler error.

## Styling
WAF supports multiple styling approaches:
1. **Global CSS**: Standard `.css` files imported in `index.html` or at the app root.
2. **CSS Modules**: Files named `*.module.css` provide class name isolation (hashing).
3. **Tailwind CSS v4**: Built-in support for Tailwind v4 utility classes.

## Lifecycle Hooks
Components support two primary lifecycle hooks that are automatically transformed by the compiler:
* `onMount(() => { ... })`: Runs when the component is added to the DOM.
* `onCleanup(() => { ... })`: Runs when the component is removed from the DOM.

**Note**: You do NOT need to import these functions; the compiler handles them globally within `.wc.jsx` files.
