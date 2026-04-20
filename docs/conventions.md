# File Conventions

## File Types

### `.jsx` / `.tsx`
* **Compiles to**: Either a `render()` function (for pages) or a Web Component (for components).
* **Page Convention**: Files named `page.jsx` or `page.tsx` act as route entry points. Their default export is transformed into a `render(root)` function.
* **Component Convention**: Any other `.jsx` or `.tsx` file is automatically transformed into a reusable Web Component (Custom Element).

### Reusable UI Components
* **Auto-Registration**: Any PascalCase function (e.g., `function Button()`) that is not the default export of a page file is automatically registered as a Web Component.
* **Naming**: Registered with the `waf-` prefix (e.g., `LoginForm.jsx` -> `<waf-loginform>`).
* **Usage**: Can be imported and used as standard HTML tags in any JSX file.

### `.js` / `.ts`
* **Used for**: Utilities, business logic, signals, and shared state.

## Rules
* All files MUST export a default function.
* Components MUST follow PascalCase naming (e.g., `Counter`).
* **File-based Routing**: Only files named `page.jsx` or `page.tsx` can be targeted by the router.
* **Component Isolation**: Tag usage of a `.jsx` page file as a component is strictly forbidden. Use dedicated component files instead.
* **CSS Classes**: You may use either `class` or `className` in your JSX. The compiler automatically maps both to the native `className` property.
* **Inline Styles**: Supports React-style style objects: `style={{ display: 'flex', gap: '10px' }}`.
* **SVG/Attributes**: Supports camelCase attributes (e.g., `strokeWidth`) which are automatically mapped to their kebab-case versions in the DOM.
* **Comments**: Standard JSX comments `{/* ... */}` are supported. If using single-line comments `{ // ... }`, ensure the closing brace is on a new line to avoid syntax errors.

## Styling
WAF supports multiple styling approaches:
1. **Global CSS**: Standard `.css` files imported in `index.html` or at the app root.
2. **CSS Modules**: Files named `*.module.css` provide class name isolation (hashing).
3. **Tailwind CSS v4**: Built-in support for Tailwind v4 utility classes.

## Global Signal Macros
WAF provides global "macros" for reactivity that do not require imports. The compiler automatically transforms these and injects the necessary imports:
* `$state(initialValue)`: Creates a reactive signal (Maps to `@preact/signals`'s `signal`).
* `$effect(() => { ... })`: Runs a side effect when signals used inside change (Maps to `effect`).
* `$derived(() => expression)`: Creates a memoized reactive value (Maps to `computed`).

**Usage Example:**
```jsx
export default function Counter() {
  const count = $state(0);
  const doubled = $derived(() => count.value * 2);

  $effect(() => console.log(count.value));

  return <button onclick={() => count.value++}>{doubled.value}</button>;
}
```

## Lifecycle Hooks
Components support two primary lifecycle hooks:
* `onMount(() => { ... })`: Runs when the component is added to the DOM.
* `onCleanup(() => { ... })`: Runs when the component is removed from the DOM.


**Note**: You do NOT need to import these functions; the compiler handles them globally within `.jsx` or `.tsx` component files.
