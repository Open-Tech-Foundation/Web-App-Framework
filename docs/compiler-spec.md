# Compiler Specification (Babel Plugin)

## Transformation Rules

### 1. Element Creation
* Lowercase tags (`div`, `span`) -> `document.createElement("tag")`.
* Uppercase tags (`Button`) -> `document.createElement("waf-button")`.

### 2. Reactivity & Macros
* **Global Macros**:
    * `$state(v)` -> `signal(v)`
    * `$effect(fn)` -> `effect(fn)`
    * `$derived(fn)` -> `computed(fn)`
* **Auto-Imports**: The compiler automatically adds imports for `signal`, `effect`, or `computed` from `@preact/signals` (or any other configured signal library) when these macros are used.
* **Text Bindings**: Expressions in text nodes (`{count.value}`) -> `createTextNode("")` + `effect(() => textNode.textContent = expr)`.
* **Attribute Bindings**: Expressions in attributes (`value={val.value}`) -> `effect(() => el.value = expr)`.


### 3. Attributes & Properties
* **Class Handling**: Both `class` and `className` are automatically mapped to the standard DOM `className` property.
* **Style Handling**: 
    * If `style` is a string, it's assigned to `el.style`.
    * If `style` is an object (expression), `Object.assign(el.style, value)` is used.
* **Attribute Mapping**: For native elements, camelCase attributes (e.g., `strokeWidth`) are automatically converted to kebab-case (e.g., `stroke-width`) and applied via `setAttribute`.
* **Properties**: Specific attributes (`value`, `checked`, `id`, `title`, `href`, `src`) are assigned as JS properties for maximum compatibility.
* **Events**: Attributes starting with `on` (e.g., `onclick`) are assigned directly as properties: `el.onclick = value`.

### 4. Components
* Any PascalCase function (not being a page's default export) is transformed into a class extending `HTMLElement`.
* `props` are proxied to `observedAttributes` and signals.
* The component is automatically registered via `customElements.define("waf-name", Class)`.
* Default exports are automatically wrapped or transformed based on the file type (Page vs. Component).


### 5. Lifecycle Transformation
The compiler detects calls to `onMount` and `onCleanup` in the component's setup scope:
* **onMount(fn)**: The call is moved to the end of `connectedCallback`, ensuring it runs after the DOM is fully constructed and appended.
* **onCleanup(fn)**: The call is transformed into `this._onCleanups.push(fn)` within `connectedCallback`. This preserves the closure (access to `props`, local variables). These are then executed in the native `disconnectedCallback`.

### 6. Comments & Empty Expressions
The compiler automatically detects and ignores `JSXEmptyExpression` nodes. This allows for standard JSX comments `{/* ... */}` to be used anywhere within the JSX structure without impacting the generated code or causing runtime errors.

### 7. Pages (.jsx)
* Transformed into a `render(root)` function.
* Appends the root JSX element to the passed element.
