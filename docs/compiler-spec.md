# Compiler Specification (Babel Plugin)

## Transformation Rules

### 1. Element Creation
* Lowercase tags (`div`, `span`) -> `document.createElement("tag")`.
* Uppercase tags (`Button`) -> `document.createElement("waf-button")`.

### 2. Reactivity
* Expressions in text nodes (`{count.value}`) -> `createTextNode("")` + `effect(() => textNode.textContent = expr)`.
* Expressions in attributes (`value={val.value}`) -> `effect(() => el.value = expr)`.

### 3. Attributes & Properties
* **Class Handling**: Both `class` and `className` are automatically mapped to the standard DOM `className` property.
* **Events**: Attributes starting with `on` (e.g., `onclick`) are assigned directly as properties: `el.onclick = value`.

### 4. Components (.wc.jsx)
* Transformed into a class extending `HTMLElement`.
* `props` are proxied to `observedAttributes` and signals.
* Default export is the class itself.
* `customElements.define("waf-name", Class)` is called automatically.

### 5. Lifecycle Transformation
The compiler detects calls to `onMount` and `onCleanup` in the component's setup scope:
* **onMount(fn)**: The call is moved to the end of `connectedCallback`, ensuring it runs after the DOM is fully constructed and appended.
* **onCleanup(fn)**: The call is transformed into `this._onCleanups.push(fn)` within `connectedCallback`. This preserves the closure (access to `props`, local variables). These are then executed in the native `disconnectedCallback`.

### 6. Comments & Empty Expressions
The compiler automatically detects and ignores `JSXEmptyExpression` nodes. This allows for standard JSX comments `{/* ... */}` to be used anywhere within the JSX structure without impacting the generated code or causing runtime errors.

### 7. Pages (.jsx)
* Transformed into a `render(root)` function.
* Appends the root JSX element to the passed element.
