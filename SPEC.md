# OTF Web - Technical Specification
**Part of the Open Tech Foundation Ecosystem**

## 1. Philosophy
OTF Web is a **native-first, fullstack** framework for building modern web applications.
- **Fullstack**: Integrated routing and Static Site Generation (SSG) for high-performance delivery.
- **Zero-VDOM**: No virtual DOM diffing. JSX is compiled directly to imperative DOM operations.
- **Native-first**: UI components are standard Custom Elements (`HTMLElement`).
- **Signal-based**: Fine-grained reactivity powered by `@preact/signals-core`.

### 1.1 Single Source of Reactivity
To prevent reactivity loss caused by multiple instances of the reactivity engine (e.g., version mismatches or duplicate bundling), OTF Web enforces a **Single Source of Truth**:
- **Central Export**: All reactive primitives (`signal`, `computed`, `effect`) MUST be imported from `@opentf/web` (which re-exports from `core/signals.js`).
- **Global Guard**: The runtime includes a global guard that warns if multiple instances of the signals library are loaded.
- **Strict Checks**: Internal runtime helpers (`createPropsProxy`, `setProperty`) use strict identity checks (`instanceof Signal`) and a framework-defined `brand` (`Symbol.for("preact-signals")`) to validate reactive objects.

### 1.2 TypeScript & JSX Configuration
OTF Web uses a custom JSX compilation pipeline. To use TypeScript or language server features, configure your `tsconfig.json` or `jsconfig.json` as follows:
```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentf/web",
    "jsxFactory": "h",
    "jsxFragmentFactory": "f"
  }
}
```

---

## 2. Component Model

### 2.1 Component Functions
- **Trigger**: A function is treated as a component **only if it contains JSX**.
- **Transformation**: Functions containing JSX (and following PascalCase naming for UI components) are compiled into a subclass of `HTMLElement` (Custom Element).
- **Pure JS**: Functions without JSX remain standard JavaScript functions.

### 2.2 Page Render Functions
- Defined as the `export default` function in a routing file: **specifically** `page.jsx`, `layout.jsx`, or `404.jsx`.
- **Transformation**: Compiled into a named `render(root, props)` function.
- **Usage**: Used as the entry point for a route by the framework's router.

### 2.3 Internal State Properties
The following properties are defined on every component instance in the `constructor`. They are defined using `Object.defineProperty` with `enumerable: false` to ensure they remain hidden from iteration (e.g., `Object.keys`), serialization (e.g., `JSON.stringify`), and to maintain a clean "native-like" appearance in developer tools.
- `_propsSignals`: A dictionary object used as the reactive backing store for component props.
    - **Purpose**: Stores the actual `signal` objects for each prop/attribute to enable fine-grained reactivity.
    - **Initialization**: Signals are lazily created during the first property access via `createPropsProxy`.
    - **Initial Value Chain**: The framework resolves values in this order: `Property Value` → `Attribute Value (string)` → `undefined`.
- `_onMounts`: An array of functions to run on `connectedCallback`.
    - **Initialization**: Initialized as `[]` in the `constructor`.
- `_onCleanups`: An array of functions to run on `disconnectedCallback`.
    - **Initialization**: Initialized as `[]` in the `constructor`.
- `_children`: An array storing the original `childNodes` of the element.
    - **Population**: Captured in `connectedCallback` using `Array.from(this.childNodes)` *before* the compiler clears the element for rendering.
- `_mounted`: A boolean flag tracking the component's initial DOM construction.
    - **Initialization**: Initialized as `false` in the `constructor`.

---

### 2.4 Fragments
JSX Fragments (`<>...</>`) are transformed into `DocumentFragment` objects.
- **Root Return**: If a component returns a fragment, the fragment's children are appended directly to the component's root (or the provided `root` node in page renders).
- **Identity**: Fragments do not have a DOM identity; they only serve as a container during the initial append operation.

### 2.5 Props vs. Attributes
The framework provides a unified interface for both DOM Attributes and JS Properties:
- **Attributes**: String-based values defined in HTML. Synced via `observedAttributes` and `attributeChangedCallback`.
- **Properties (Props)**: Rich data types (Objects, Arrays, Functions) passed via JS assignment.
- **Unification**: Both update the same signal in `_propsSignals`, allowing the component logic to remain agnostic of the data source.

### 2.6 Component Return Patterns
OTF Web component functions are **executed once** during initialization. This "Init-Once" model impacts how return statements are processed.

#### 2.6.1 Static vs. Reactive Conditionals
Top-level `if` statements and ternaries are **static**. They are evaluated only once at mount.
- **Static Pattern**: `if (!user) return <Login />` will never switch to the main layout even if `user` becomes truthy later.
- **Reactive Pattern**: To switch layouts reactively, return a stable root and use inline conditionals: `return <div>{user ? <Main /> : <Login />}</div>`.

#### 2.6.2 Variable Declarations
Returning a variable containing a JSX element is fully supported.
**JSX**:
```javascript
const layout = <div><Header />{children}</div>;
return layout;
```
**Output**: The compiler treats the variable assignment as the primary DOM construction block and appends it to the component root.

#### 2.6.3 Multi-Return Support
The compiler supports multiple return paths (e.g., inside `if/else` blocks), but again, these are determined at the moment of component instantiation.

### 2.7 Destructured Props
Destructuring props in the component signature is a first-class pattern in OTF Web. 

- **Automatic Observation**: Keys extracted via destructuring (e.g., `function Comp({ name })`) are automatically added to the `observedAttributes` of the Custom Element.
- **Reactive Rewriting**: The compiler rewrites all usages of destructured variables in the component body to access the `_waf_props` proxy directly. This ensures that even though the variable looks like a static constant, its usage in JSX remains reactive.
- **Renaming & Defaults**: Patterns like `{ name: n = "Guest" }` are supported. The compiler tracks the alias `n` and maps it back to the `name` signal on the proxy.
- **Rest Pattern**: `{ title, ...others }` is supported. While `title` remains reactive, the `others` object is a static snapshot of the remaining props at the time of access.

### 2.8 Direct Props Access
Using the `props` object directly (e.g., `function Comp(props)` or `function Comp(p)`) is supported with the following behavior:

- **JSX Discovery**: The compiler tracks the actual parameter identifier. It scans JSX expressions for `[identifier].key` access and automatically adds those keys to the `observedAttributes` list.
- **Reactive JSX**: Accesses like `{props.name}` are rewritten to `_waf_props.name.value` and are fully reactive.
- **Static Body Access**: Accessing `props.name` in the component body (outside of JSX) returns a **static snapshot** of the prop value at the time of component initialization. To maintain reactivity in the body, destructuring or `$derived` is required.

### 2.9 Nested Props in JSX
Deep path access on the `props` object follows the **First-Access Rule**: the compiler unwraps the property immediately following `props`.

- **Transformation**: `<div>{props.user.name}</div>` → `_effect(() => el.textContent = _waf_props.user.value.name)`
- **Behavior**: This pattern assumes that `user` is the Signal and `name` is a plain property of the object contained within that signal.
- **Lists**: For arrays, `props.items.map(...)` transforms to `props.items.value.map(...)`, which is then optimized via `_mapped()` at runtime.

### 2.10 Default Props
Default values in the component signature are supported and maintained reactively by the compiler.

- **Automatic Fallback**: If a default value is provided (e.g., `{ name = "World" }`), the compiler uses it as a fallback during reactive unwrapping.
- **Strict JS Parity**: To match standard JavaScript destructuring behavior, the fallback is applied strictly using an `!== undefined` check, ensuring that an explicit `null` value is preserved.
- **Transformation**: `<div>{name}</div>` → `_effect(() => el.textContent = (_waf_props.name.value !== undefined ? _waf_props.name.value : "World"))`
- **Dynamic Compatibility**: This ensures that if a prop is initially missing but is provided later (e.g., via `setAttribute`), the component will transition from the default value to the new reactive value seamlessly.

### 2.11 CSS Encapsulation
By default, OTF Web components use **Light DOM**.
- **Rationale**: Ensures that global styles (like Tailwind CSS or design system tokens) apply naturally to components without complex workarounds (like `@apply` or CSS parts).
- **Scoped CSS**: To prevent style leakage, developers are encouraged to use **CSS Modules** or the **Component Path Namespace** as a class prefix.
- **Shadow DOM**: Support for Shadow DOM and the `@shadow` directive is **deferred** to a future version. Components currently only support Light DOM rendering.

---

## 3. Reactivity & Macros

### 3.1 Signals
OTF Web uses `@preact/signals-core`. The compiler automatically manages `.value` access.
- **Microtask Batching**: Multiple synchronous signal updates are automatically batched by the core engine into a single microtask. This guarantees that `_effect` closures (and DOM updates) only run once per synchronous execution block, delivering maximum performance with zero manual `batch()` boilerplate.

### 3.2 Compiler Macros
Macros are special function calls that the compiler transforms:
- `$state(init)`: Transforms to `signal(init)`.
- `$derived(expression)`: Transforms into a Signal-based computed value.
    - **Auto-wrapping**: If a raw expression or a function call is passed (e.g., `$derived(a + b)` or `$derived(compute())`), the compiler automatically wraps it in an arrow function (`() => a + b` or `() => compute()`).
    - **Function Pass-through**: If a function literal (arrow function or anonymous function) is passed (e.g., `$derived(() => count * 2)`), it is used directly without additional wrapping.
    - **Reactivity Scoping**: Inside a `$derived` arrow function, the **First-Access Rule** still applies to `$signal` variables. The compiler will unwrap property access once within the scope of the computed callback.
- `$effect(callback)`: Compiler macro for side effects. 
    - **SSG Guard**: The compiler automatically wraps `$effect()` calls in an `if (!isSSG)` check to prevent build-time execution of client-side logic.
    - **Disposal**: The compiler automatically registers the effect's dispose function in the component's `_onCleanups` array.
- `$ref()`: Transforms to `signal(null)` — a fully reactive signal holding a DOM node (or `null` before mount). Used in JSX: `<div ref={myRef}>` (see §5.6). Read it in `$effect` (re-runs on node change), `onMount`, or `onCleanup`.
- `$expose(obj)`: Transforms to `Object.assign(this, obj)` within the component class.
    - **Scoping**: The compiler rewrites the target of `Object.assign` to the component instance (`this`), exposing the object's properties as public properties of the Custom Element.

### 3.3 Auto-unwrapping (.value Injection)
The compiler injects `.value` access for variables identified as signals (`$state`, `$derived`, `$ref`) and for `props` access.
- **Rule**: If a variable `v` is a signal, `v` becomes `v.value` in expressions.
- **Exceptions**: `v` remains `v` when:
    - Passed to the `ref` attribute.
    - Used in an assignment (e.g., `v = 10` becomes `v.value = 10`).
    - Used in an update expression (e.g., `v++` becomes `v.value++`).
    - It is the `children` property of the `props` object (e.g., `props.children` remains `props.children`).

### 3.4 Forbidden Patterns
To maintain reactivity integrity and compiler predictability, the following patterns are explicitly forbidden and will trigger a compiler error:
1.  **Manual `.value` Access**: Accessing `.value` on variables declared with `$state`, `$derived`, or `$ref` is prohibited. The compiler handles all unwrapping.
2.  **Conditional Macros**: Using `$state`, `$derived`, or `$effect` inside `if` statements or loops. Macros must be defined at the top level of the component function.
3.  **Late Assignment to Props**: Re-assigning the `props` object itself is forbidden.
4.  **Macro Interaction**: Nesting macros as direct arguments (e.g., using `$derived($signal(...))`) is forbidden. However, passing a function that evaluates a macro (e.g., `$derived(() => form.values.members)`) is perfectly valid because the arrow function isolates the expression.
5.  **Async Components**: `async function MyComp() { ... }` is forbidden. Components must execute synchronously. Use the Resource Pattern (Section 7.4) for async data.
6.  **Generator Functions**: `function* MyComp() { ... }` is unsupported.
7.  **Class Components**: `class MyComp extends HTMLElement { ... }` is explicitly unsupported in the compiler pipeline. Use functional components.
8.  **Dynamic Imports in Body**: `await import(...)` inside the component body breaks synchronous execution and is forbidden.
9.  **Callback (function-valued) Refs**: A function passed to the `ref` attribute (`ref={(el) => …}`) is forbidden. `ref` takes a `$ref` signal; use `$ref` + `$effect`/`onMount`/`onCleanup` (or `$expose`) for node-attachment behavior (see §5.6).
10. **In-place Mutation of `$state`**: A `$state` signal's value is *replaced*, never mutated — reactivity fires on `signal.value = …`, not on mutating the object the value points at. Mutating it in place therefore updates the data but notifies no effect, silently losing the update. The compiler rejects mutations rooted at a `$state` variable: mutating array methods (`push`, `pop`, `shift`, `unshift`, `splice`, `reverse`, `sort`, `fill`, `copyWithin`), `Map`/`Set` mutators (`set`, `add`, `delete`, `clear`), index/`length` assignment (`list[0] = x`, `list.length = 0`), property assignment (`obj.a.b = x`), member increment/decrement (`obj.n++`), and the `delete` operator (`delete obj.key`). Reassign immutably instead (`list = [...list, item]`, `list = list.filter(…)`, `list = list.toSorted(…)`), or hold the data in a `reactive()` store (§1.1) for direct mutation. Detection is symbol-precise: a shadowing local or an alias (`const tmp = list; tmp.push(…)`) is not flagged — it escapes the signal and reactivity is lost with no diagnostic. Read methods (`map`, `filter`, `get`, `has`, …) stay legal — they are how JSX and `_mapped()` consume the collection. `$ref`/`$derived`/`$context` are excluded, so imperative DOM writes on a `$ref` (`el.scrollTop = 0`) remain valid.

### 3.5 $signal() Macro
`$signal()` is the **explicit bridge** between external reactive objects and the OTF Web compiler. It tells the compiler: *"this object contains signals — track its reactive properties in JSX."* 

#### 3.5.1 Syntax & Compilation
```javascript
const x = $signal(externalReactiveObject)
```
- **Declaration**: `const x = externalReactiveObject` (zero runtime cost).
- **The First-Access Rule**: The compiler automatically injects `.value` **only on the first property access** following a `$signal` variable.
  - **Logic**: This "unlocks" the reactive container, exposing the plain data inside.
  - **Example**: `<span>{x.user.name}</span>` → `_effect(() => el.textContent = x.user.value.name)`
- **Destructuring**: Destructuring a `$signal` variable is supported. The compiler tracks the resulting variables as signals.
  - **JSX**: `const { count } = $signal(store); <div>{count}</div>`
  - **Output**: `_effect(() => el.textContent = count.value)`

#### 3.5.2 Hybrid Reactivity (Lists)
When combined with `_mapped()`, `$signal` allows for deep reactivity without deep signals in the data source.
**Input**:
```jsx
const form = $signal(createForm({ members: [{ name: "Alice" }] }))
return (
  <ul>
    {form.members.map(m => <li>{m.name}</li>)}
  </ul>
)
```
**Output**:
```javascript
_mapped(
  () => form.members.value, // Level 1 unwrap via First-Access Rule
  (m) => {
    // m is "reified" into a signal by _mapped at runtime
    const el = document.createElement("li")
    _effect(() => el.textContent = m.value.name)
    return el
  }
)
```

#### 3.5.3 Rules
- **Component Top Level**: MUST be declared at the component top level.
- **Object Only**: MUST wrap a plain object containing reactive state.
- **No Explicit Typing**: The compiler uses a single-level unwrap heuristic (the First-Access Rule) rather than relying on TypeScript or JSDoc. It blindly unwraps the first property access on a `$signal` variable.
- **No Manual .value**: `.value` is FORBIDDEN on `$signal()` variables or their destructured children in component code.
- **Priority Detection**:
  1. Local Macros (`$state`, `$derived`, `$ref`)
  2. Variables from `$signal()` (including destructured ones)
  3. Static values


---

## 4. Component Transformation
This section shows how the compiler progressively builds the OTF Web component class based on the features used in the JSX function.

### 4.0 Component Naming (Namespacing)
A Custom Element name lives in one process-global `CustomElementRegistry`, so a tag
derived from the bare identifier (`Counter` → `web-counter`) collides whenever two
components — in different files or packages — share a name; the second `define`
throws. The compiler is a per-module front-end and never resolves a callee's module,
so tags are made collision-free **without cross-module resolution**:

- **Registration tag** (definition site): `web-<kebab>-<hash>`, where `<hash>` is an
  FNV-1a hash of the component's module id. This is unique per defining module, so
  same-named components never collide. The class exposes it as `static tag` (and the
  SSG render fn as `.tag`).
- **Addressing** (call site): a component is referenced through a binding that already
  carries its tag, never a recomputed string — the **imported binding** (`Counter.tag`)
  for a cross-module use, or the **sibling class** (`CounterElement.tag` /
  `Counter_ssg.tag`) for a same-module use. *Consequence:* a component used in another
  module must be imported there (standard ESM); there is no implicit global-by-tag
  lookup.
- **Stable styling hook**: every host is stamped with a stable `web-<kebab>` **class**
  (CSR `classList.add`, SSG host attribute) — independent of the hashed tag — so CSS
  targets hosts by a readable, stable name. Classes are not registry-unique, so two
  same-named components sharing the hook is fine for styling.
- **Framework built-ins** use reserved, stable tags: `web-link` and `web-internal-*`
  (`web-internal-portal`, `web-internal-context-provider`, `web-internal-error-boundary`,
  `web-internal-raw-html`). The compiler knows these by identifier and emits the literal
  tag (needed e.g. for `<RawHtml>` injected by the MDX front-end, which has no import to
  reference).
- **Registration is idempotent** (`if (!customElements.get(Class.tag)) define(…)`) so a
  tag reused across chunks, or a built-in already defined, never throws.

> Code examples elsewhere in this spec write a simplified `web-foo` tag for
> readability; the emitted tag is the namespaced `web-foo-<hash>` described here.

#### 4.0.1 Member-expression component names are unsupported (by design)
Dotted/namespaced component names — `<Foo.Bar/>`, the React "compound component"
pattern — are **intentionally not supported**, not a missing feature. Every UI
component compiles to a Custom Element addressed by a *static* tag (see §4.0); a
member expression like `Foo.Bar` is a runtime **value** lookup with no tag to register
or resolve against, so it is fundamentally incompatible with the tag-based component
model. The compiler reports it as a diagnostic rather than emitting a broken element.

**Instead:** give the inner piece its own top-level component (`<FooBar/>`), or
compose via children/`$context` (e.g. a `<Tabs>` provider with `<TabPanel>`
children) — the Custom-Element-native equivalent of compound components.

### 4.1 Level 1: Static Component
**Input**:
```jsx
export function Static() {
  return <div>Hello</div>;
}
```
**Output**:
```javascript
// Helper for non-enumerable properties
function defineInternalProp(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: true,
    configurable: true
  });
}

class StaticElement extends HTMLElement {
  constructor() {
    super();
    defineInternalProp(this, "_mounted", false);
    defineInternalProp(this, "_onMounts", []);
    defineInternalProp(this, "_onCleanups", []);
  }

  connectedCallback() {
    if (!this._mounted) {
      const el0 = document.createElement("div");
      el0.appendChild(document.createTextNode("Hello"));
      this.appendChild(el0);
      this._mounted = true;
    }
    
    this._onMounts.forEach(fn => fn());
  }

  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
    this._onCleanups = [];
  }
}
customElements.define("web-static", StaticElement);
```

### 4.2 Level 2: Component with Props
**Input**:
```jsx
export function Greet({ name }) {
  return <div>Hello {name}</div>;
}
```
**Output**:
```javascript
class GreetElement extends HTMLElement {
  static observedAttributes = ["name"];

  constructor() {
    super();
    defineInternalProp(this, "_propsSignals", { name: signal(null) });
    defineInternalProp(this, "_mounted", false);
    defineInternalProp(this, "_onMounts", []);
    defineInternalProp(this, "_onCleanups", []);
  }

  attributeChangedCallback(name, old, val) {
    if (this._propsSignals[name]) this._propsSignals[name].value = val;
  }

  connectedCallback() {
    const _waf_props = createPropsProxy(this);
    const { name } = _waf_props;

    if (!this._mounted) {
      const el0 = document.createElement("div");
      el0.appendChild(document.createTextNode("Hello "));
      
      const text0 = document.createTextNode("");
      defineInternalProp(this, "_text0", text0); // Persist for re-activation
      el0.appendChild(text0);
      
      this.appendChild(el0);
      this._mounted = true;
    }

    // Reactivity Activation
    this._onCleanups.push(
      _effect(() => this._text0.textContent = name.value)
    );
    
    this._onMounts.forEach(fn => fn());
  }

  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
    this._onCleanups = [];
  }
}
customElements.define("web-greet", GreetElement);
```

### 4.2.5 Level 2.5: Component with Property Syncing (Setters/Getters)
When props are used, the compiler generates JS getters and setters to sync property assignments directly to internal signals.
**Output (Partial)**:
```javascript
class GreetElement extends HTMLElement {
  static observedAttributes = ["name"];

  // Generated setter for property access: el.name = "..."
  set name(_val) {
    if (!this._propsSignals["name"]) {
      this._propsSignals["name"] = signal(_val);
    }
    this._propsSignals["name"].value = _val;
  }

  // Generated getter for property access: console.log(el.name)
  get name() {
    const _sig = this._propsSignals["name"];
    return _sig ? _sig.value : undefined;
  }

  constructor() {
    super();
    defineInternalProp(this, "_propsSignals", { name: signal(null) });
    defineInternalProp(this, "_mounted", false);
  }
  // ...
}
```

### 4.3 Level 3: Component with State and Events
**Input**:
```jsx
export function Counter() {
  let count = $state(0);
  return <button onclick={() => count++}>{count}</button>;
}
```
**Output**:
```javascript
class CounterElement extends HTMLElement {
  constructor() {
    super();
    defineInternalProp(this, "_mounted", false);
    defineInternalProp(this, "_onMounts", []);
    defineInternalProp(this, "_onCleanups", []);
  }

  connectedCallback() {
    let count = signal(0); // State preserved across re-activations? No, state is local to connectedCallback.
    // NOTE: For persistent state across disconnect/reconnect, use properties or external stores.

    if (!this._mounted) {
      const el0 = document.createElement("button");
      el0.onclick = () => count.value++;
      
      const text0 = document.createTextNode("");
      defineInternalProp(this, "_text0", text0);
      el0.appendChild(text0);

      this.appendChild(el0);
      this._mounted = true;
    }

    this._onCleanups.push(
      _effect(() => this._text0.textContent = count.value)
    );

    this._onMounts.forEach(fn => fn());
  }

  disconnectedCallback() {
    this._onCleanups.forEach(fn => fn());
    this._onCleanups = [];
  }
}
customElements.define("web-counter", CounterElement);
```

### 4.4 Prop Update Vectors
Component props can be updated from the outside via several vectors, all of which are synchronized to the internal signal:
1.  **Attribute Change**: `el.setAttribute('key', 'val')` triggers `attributeChangedCallback`.
2.  **Property Assignment**: `el.key = 'val'` triggers a generated setter on the class.
3.  **Parent Reactivity**: JSX assignments like `<Comp key={sig} />` are wrapped in an `effect` that calls `setProperty`.
4.  **DevTools**: Manual edits to attributes in the browser inspector are treated as attribute changes.

### 4.5 Component Children (`_children`)
When a component receives children in JSX, they are captured during initialization.
**Input**:
```jsx
export function Wrapper({ children }) {
  return <div class="box">{children}</div>;
}

// Parent usage:
// <Wrapper><span>Child</span></Wrapper>
```
**Output (Partial)**:
```javascript
// Inside WrapperElement's connectedCallback:
// _children array is populated automatically by the base class constructor
// from `Array.from(this.childNodes)` before rendering.
const _waf_props = createPropsProxy(this);
// The proxy exposes `children` which resolves to `this._children`.

const el0 = document.createElement("div");
el0.setAttribute("class", "box");

// children are appended dynamically
_renderDynamic(el0, () => _waf_props.children.value);
```

### 4.6 Exposed Properties (`$expose`)
Components can expose methods and state to their parent via `$expose`.
**Input**:
```jsx
export function Modal() {
  let open = $state(false);
  $expose({ show: () => open = true });
  return open ? <dialog>...</dialog> : null;
}
```
**Output**:
```javascript
class ModalElement extends HTMLElement {
  connectedCallback() {
    // ...
    let open = signal(false);
    
    // Transformed $expose macro:
    Object.assign(this, {
      show: () => open.value = true
    });
    // Now `el.show()` is callable from the outside.
  }
}
```

## 5. JSX Transformation Patterns
This section defines how various JSX patterns are transformed into imperative DOM operations by the compiler.

### 5.1 Static Elements
**JSX**: `<div>Hello</div>`
**Output**:
```javascript
const el0 = document.createElement("div");
el0.appendChild(document.createTextNode("Hello"));
```

### 5.2 Attribute Patterns
The compiler transforms JSX attributes into imperative DOM operations, distinguishing between static literals and dynamic expressions.

#### 5.2.1 Static Literals
Static literals are applied once during element creation.
- **String**: `<div class="foo" />` → `el.setAttribute("class", "foo")`
- **Number**: `<input tabIndex={0} />` → `el.setAttribute("tabIndex", "0")`
- **Boolean**: `<input disabled={true} />` → `el.setAttribute("disabled", "")` (Attributes are removed if the literal is `false`).

#### 5.2.2 Dynamic Expressions
Expressions are wrapped in `_effect()` to ensure fine-grained reactivity.
- **Simple Identifier**: `<div class={cls} />` → `_effect(() => _setProperty(el, "class", cls.value))`
- **Ternary**: `<div class={isActive ? "on" : "off"} />` → `_effect(() => _setProperty(el, "class", isActive.value ? "on" : "off"))`
- **Logical AND**: `<div class={isActive && "active"} />` → `_effect(() => _setProperty(el, "class", isActive.value && "active"))`
- **Template Literal**: ``<div class={`btn ${variant}`} />`` → ``_effect(() => _setProperty(el, "class", `btn ${variant.value}`))``

#### 5.2.3 Special Attributes & Values
- **Style Object**: `<div style={{ color: "red", fontSize: 14 }} />` → `Object.assign(el.style, { color: "red", fontSize: 14 })`
- **Data & Aria Attributes**: `data-*` and `aria-*` attributes are treated as standard attributes and applied via `setAttribute`.
- **Null/Undefined Handling**:
    - **Native Elements**: If an expression evaluates to `null` or `undefined`, the attribute is removed: `el.removeAttribute(key)`.
    - **OTF Web Components**: If a prop is set to `null` or `undefined`, the value is **preserved** and updated in the underlying signal (`propSignal.value = null`), allowing the component to react to the empty state.

#### 5.2.4 Spread Attributes (Order Matters)
Spread attributes are applied via `_applySpread()`. The order of attributes in JSX is preserved in the output, meaning later attributes can override earlier ones.
- **Static Override**: `<div {...props} class="override" />`
  - The compiler generates the spread effect followed by the static `setAttribute("class", "override")`.
- **Dynamic Override**: `<div class="base" {...props} />`
  - The static attribute is set first, but the spread effect may later override it if `props` contains a `class` key.
- **Runtime Event Normalization**: The `_applySpread` runtime helper MUST replicate the compiler's event normalization rules (see Section 5.3). When spreading an object containing `{ onClick: fn }`, it must be applied as `.onclick` to native elements and `.onClick` to components.

### 5.3 Event Handlers

#### 5.3.1 Normalization Rule
The compiler applies different case normalization based on whether the target element is a native HTML element or a WAF Component.
- **Native Elements**: Attributes starting with `on` are normalized to **lowercase** property assignments.
- **Component Elements**: Attributes starting with `on` preserve their **original case** (typically camelCase) for property assignment.

| Target Type | JSX Pattern | Compiled Output |
| :--- | :--- | :--- |
| **Native** | `<button onClick={fn} />` | `el.onclick = fn;` |
| **Native** | `<input onKeyDown={fn} />` | `el.onkeydown = fn;` |
| **Component** | `<MyComp onDataLoad={fn} />` | `el.onDataLoad = fn;` |
| **Component** | `<MyComp onClick={fn} />` | `el.onClick = fn;` |

#### 5.3.2 Inline Handlers (No Hoisting Required)
Unlike VDOM frameworks where inline handlers are re-created on every render, OTF Web component functions follow the **Init-Once** model. 
- **Setup Only**: The component body is executed exactly once during `connectedCallback`.
- **Zero Overhead**: Inline arrow functions in event handlers are created only once per component instance.
- **Output**: The compiler simply assigns the inline function directly to the property without any need for hoisting or `useCallback` equivalents.

**JSX**: `<button onclick={() => count++} />`
**Output**:
```javascript
el.onclick = () => count.value++;
```

#### 5.3.3 Detection Logic
The compiler determines the normalization strategy using the following tag-name rules:
- **Native**: Tag is all lowercase or is a known HTML tag.
- **Component**: Tag is PascalCase or contains a hyphen (`-`).

#### 5.3.4 Explicit Constraints
- **`on` Prefix Required**: Any attribute intended as an event handler MUST start with `on`. Without this prefix, it is treated as a standard attribute or property.
- **No Automatic Cleanup**: WAF does not automatically detach event handlers assigned via properties. Developer-owned lifecycle management is expected for complex cleanup scenarios.
- **No `addEventListener`**: The compiler always emits property assignments (`el.onclick = ...`) and never emits `addEventListener` calls.
- **Dynamic Events Prohibited**: Dynamic event names (e.g., `<div {name}={fn} />` or `<div on={name} />`) are not supported.

### 5.4 Children Patterns
OTF Web handles various children types through a combination of static creation and dynamic rendering helpers.

#### 5.4.1 Static Children
Static children are created and appended once during element initialization.
- **Text**: `<div>Hello</div>` → `el.appendChild(document.createTextNode("Hello"))`
- **Nested Elements**: `<div><span>text</span></div>` → Nested `createElement` and `appendChild`.
- **Multiple Static Children**: `<div><A /><B /></div>` → Sequential creation and appending.
- **Mixed Content**: `<div>Hello <strong>{name}</strong>!</div>` → Mix of static text nodes and dynamic segments.
- **HTML Entities**: Standard HTML entities (e.g., `&copy;`, `&amp;`, `&lt;`) are supported. The compiler transforms them into their corresponding Unicode characters within the generated text nodes.
  - **JSX**: `<div>&copy; 2024</div>` → `el.appendChild(document.createTextNode("\u00A9 2024"))`
- **JSX Comments**: Comments within JSX braces (`{/* comment */}`) are stripped by the compiler and result in no output in the final DOM.
- **Whitespace & Multiline Text**: Standard JSX whitespace rules apply. Leading and trailing whitespace on newlines is stripped, and internal newlines/multiple spaces are collapsed into a single space in the resulting text node.

#### 5.4.2 Fragments
Fragments are transformed into `DocumentFragment` for batch appending. They provide a grouping mechanism without adding extra nodes to the DOM.
**JSX**: `<><A /><B /></>` → `const frag0 = document.createDocumentFragment(); ...; parent.appendChild(frag0)`

#### 5.4.3 Dynamic Expressions
Any non-literal children (expressions, variables, or function calls) are wrapped in `_renderDynamic()` to ensure reactivity.
- **Identifiers**: `<div>{name}</div>` → `_renderDynamic(el, () => name.value)`
- **Numbers**: `<div>{count}</div>` → Stringified and rendered as a text node within the effect.
- **Conditionals**: 
  - **Logical AND**: `{show && <p>hi</p>}`
  - **Ternary**: `{show ? <A /> : <B />}`
  - **Logical OR / Nullish**: `{value || "default"}`, ``{value ?? "fallback"}``
  - **Nested Conditionals**: `{a ? (b ? <X /> : <Y />) : <Z />}`
- **Empty Values**: `null`, `undefined`, and `false` result in no DOM nodes being rendered.

#### 5.4.4 List Rendering
Arrays and `.map()` operations are transformed into `_mapped()` calls for optimized reconciliation with item identity tracking.
- **Simple Map**: `<ul>{items.map(i => <li>{i}</li>)}</ul>`
- **Keyed List**: `<ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>`
- **Nested Maps**: `<ul>{sections.map(s => s.items.map(i => <li>{i}</li>))}</ul>` (Transformed into nested `_mapped` vectors).

- **Performance (Virtual Scrolling)**: For lists with 10,000+ items, `_mapped` may still incur memory overhead. OTF Web treats virtual scrolling as a **user-land problem**. Developers can implement windowing/virtualization by combining `$derived` (to slice the data) with `_mapped` (to render the visible window), providing the necessary primitives without a heavy built-in abstraction.

##### Key Prop Behavior
The `key` prop is crucial for `_mapped` optimization:
- **Type**: Must be a `string` or `number`.
- **Fallback**: If `key` is missing, `_mapped` falls back to the array `index`.
- **Duplicates**: If keys duplicate, the framework logs a warning in development mode, and the last rendered item for that key overwrites previous cache entries (last-wins).
- **Non-list elements**: Applying a `key` prop to elements outside of a `.map()` callback is ignored by the framework.

##### Reactivity Boundary Rule
Because of the Hybrid Reactivity model, there is a strict boundary between plain data operations and reified reactive signals during list rendering.

**JSX Input:**
```javascript
{items.filter(i => i.active).map(i => <li>{i.name}</li>)}
```

**Compiled Output:**
```javascript
const _mapped0 = _mapped(
  () => items.value.filter(i => i.active),  // sourceFn — plain data
  (i) => {                                  // mapFn — i is Signal
    const el = document.createElement("li")
    _effect(() => el.textContent = i.value.name)
    return el
  }
)
_renderDynamic(el, () => _mapped0())
```

**The Rule:**
- **Methods chained BEFORE `.map()`** (e.g., `.filter()`, `.sort()`) operate on **plain data**. They re-run *only* when the parent signal reference changes. An immutable update (e.g., `items.value = [...items.value]`) is required to trigger a re-filter or re-sort.
- **Methods inside `.map()` callback** receive **Signals**. These bindings result in fine-grained DOM updates per item, without requiring list reconciliation.

##### List Reactivity Matrix

| Pattern | Valid | Trigger |
|---|---|---|
| `items.map(...)` | ✅ | items signal changes |
| `items.filter().map(...)` | ✅ | items signal changes |
| `items.sort().map(...)` | ✅ | items signal changes |
| `items.reduce(...)` | ✅ | items signal changes (no `_mapped` optimization) |
| mutate `items[0].active` directly | ❌ | won't re-filter or re-render |
| `items.value = [...items.value]` | ✅ | triggers re-filter and reconciliation |

### 5.5 Component Usage
**JSX**: `<MyComponent title={myTitle} />`
**Output**:
```javascript
const el0 = document.createElement("web-mycomponent");
_effect(() => _setProperty(el0, "title", myTitle));
```

### 5.6 Ref Attribute
The `ref` attribute takes a `$ref` **signal**. On construction the compiler assigns
the element to that signal's `.value` — the expression is kept raw (no First-Access
`.value` injection), since the ref *is* the container being written to.

**JSX**: `<div ref={myRef}></div>`
**Output**:
```javascript
const el0 = document.createElement("div");
myRef.value = el0; // Ref signal updated directly
```

Because `$ref()` transforms to `signal(null)`, a ref is a fully reactive signal:
reading it inside an `$effect` subscribes to it, so the effect re-runs whenever the
node changes (e.g. a conditional swapping `<input>` for `<textarea>` reassigns the
ref, re-running the effect with the new node).

```jsx
const el = $ref();
$effect(() => { if (el) measure(el); }); // re-measures when the node changes
onMount(() => el.focus());               // node exists after mount
onCleanup(() => teardown(el));           // node teardown on unmount
```

**Callback refs are rejected.** A function-valued `ref` — `ref={(el) => …}`,
React's "callback ref" — is **not supported** and is a compiler error (§3.4, item 9).
The ref model assigns the node to a signal; a function there has no meaning and
would emit invalid code. Every callback-ref use case is expressed with `$ref` plus
the reactive/lifecycle primitives above, or by exposing an imperative handle to the
parent with `$expose` (an API is a stronger boundary than handing out the raw node);
a dynamic collection of refs is modeled as a per-item component that owns its own
`$ref`. The diagnostic points authors to these patterns.

### 5.7 Void Elements
Void elements are elements that cannot have children (e.g., `<input />`, `<br />`, `<img />`). They are transformed like standard elements but without an `appendChild` call for children.
**JSX**: `<input type="text" />`
**Output**:
```javascript
const el0 = document.createElement("input");
el0.setAttribute("type", "text");
```

### 5.8 SVG Elements
**JSX**: `<svg><circle cx="50" /></svg>`
**Output**:
```javascript
const el0 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
const el1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
el1.setAttribute("cx", "50");
el0.appendChild(el1);
```

---

## 6. Runtime Helpers (Implementation Details)

### 6.1 `createPropsProxy(el)`
The `createPropsProxy(el)` function bridges the Web Component's attributes and properties with the functional component's expected `props` object.

- **Lazy Signal Creation**: It lazily initializes `_propsSignals` on the element. Signals are only created when a property is first accessed or set.
- **Unified Access**: It resolves values by checking JS properties first, then falling back to DOM attributes.
- **Reactive Synchronization**: 
    - **Incoming Signals**: If a signal is passed as a prop, the proxy subscribes to it and synchronizes its value to an internal signal. This maintains the identity of the prop signal within the component even if the parent passes a different signal reference later.
    - **Raw Values**: If a raw value is set, the internal signal is updated directly.
- **Identity Preservation**: By using a proxy to manage `_propsSignals`, component logic can safely destructure `props` at the top level while maintaining reactivity via the underlying signal references.
- **Brand Validation**: Uses `PREACT_SIGNALS_BRAND` to ensure only legitimate signals are processed, preventing errors with plain objects that might mimic the signal API.

### 6.2 `setProperty(el, key, value)`
A central helper for assigning values to elements. It follows this decision tree:

| Type | Key Pattern | Action |
| :--- | :--- | :--- |
| **Style** | `key === "style"` | `Object.assign(el.style, value)` |
| **Event (Native)** | `key.startsWith("on")` & `!isComponent` | `el[key.toLowerCase()] = value` |
| **Event (Comp)** | `key.startsWith("on")` & `isComponent` | `el[key] = value` |
| **Property** | `key` in `IS_PROPERTY` list | `el[key] = value` |
| **Attribute** | Default | `el.setAttribute(key, value)` (removes if null/false) |

- **`isComponent` Flag**: To accurately apply event casing (preserving camelCase for components, lowercasing for native), the compiler passes an `isComponent` boolean flag to the `setProperty` runtime helper.
  - **Compiled Output**: `_effect(() => _setProperty(el0, "onClick", fn, true))` (last arg is `isComponent`).

- **Reactivity**: If `value` is a signal, `setProperty` automatically unwraps it via `value.value`.
- **OTF Web Sync**: If `el` is a OTF Web component, `setProperty` updates the internal `el._propsSignals[key]` to propagate reactivity.

### 6.3 `renderDynamic(parent, fn)`
Handles conditional and dynamic JSX rendering via an effect-based reconciliation strategy.
- **Anchor Node**: Creates a "bookmark" (empty TextNode) in the `parent` to track the insertion point.
- **Effect-based Tracking**: Runs `fn` inside an `effect`. Whenever any signals accessed in `fn` change, the reconciliation logic is triggered.
- **Security (XSS Safe)**: By default, string and number primitives are converted to DOM nodes exclusively via `document.createTextNode()`. The framework **never** uses `innerHTML` for dynamic rendering. 
- **dangerouslySetInnerHTML**: OTF Web does **not** provide a built-in equivalent to React's `dangerouslySetInnerHTML`. If raw HTML injection is required, developers must manually use `el.innerHTML = ...` inside an `$effect`, while being solely responsible for sanitization.
- **Reconciliation**:
    - If `fn` returns a DOM node: It is inserted/moved before the anchor.
    - If `fn` returns `null/false/undefined`: Any previously rendered dynamic content is removed.
    - If `fn` returns a primitive: It is converted to a `TextNode` and rendered.

### 6.4 `_mapped(sourceFn, mapFn)`
The primary helper for reactive list rendering. 
- **Array Tracking**: Subscribes to the array returned by `sourceFn()`.
- **Item Reification**: To support deep reactivity without nested signals in the data source, `_mapped` internally **wraps each array item in a `Signal`** before passing it to `mapFn(item, index)`.
- **Optimization**: Uses an internal `Map` to cache nodes based on a `key` property (or index), ensuring that only changed or new items are rendered/updated.

### 6.5 `withInstance(inst, fn)`
A scoping helper used during component initialization.
- Sets a global `currentInstance` variable to `inst`.
- Executes `fn()`.
- Resets `currentInstance` to its previous value in a `finally` block.
- This allows `onMount` and `onCleanup` to correctly identify the active component instance during its synchronous setup.

---

## 7. Lifecycle & Environment

### 7.1 Lifecycle Hooks
- `onMount(cb)`: Executed once after the view is inserted (`connectedCallback` for components; post-insertion via the `__lifecycle` record for pages/layouts). A function returned by `cb` is collected as additional teardown.
- `onCleanup(cb)`: Executed once on removal (`disconnectedCallback` for components; on navigation for pages/layouts).
- `onResize(cb)`: Observes the component's host element (a page's root element) with a **`ResizeObserver`**; `cb(entry)` receives the `ResizeObserverEntry`. Per platform behavior the observer delivers one initial entry asynchronously after `observe()`, then on every size change. The observer is disconnected automatically on removal. Note: a custom-element host is `display: inline` by default, and ResizeObserver reports inline boxes as 0×0 — style the host (e.g. `:host`-equivalent tag selector or a `display:block` rule for the element) for meaningful measurements.
- `onVisibilityChange(cb)`: Observes the host/root element with an **`IntersectionObserver`**; `cb(isIntersecting, entry)` fires when the element enters or leaves the viewport. Disconnected automatically on removal.
- `onMediaQuery(query, cb)`: Wires `window.matchMedia(query)`; `cb(matches, mqlOrEvent)` is called **once synchronously at mount** with the initial state, then on every `change`. The listener is removed automatically on removal. The `query` expression is evaluated once at mount (a signal read inside it is a one-time `.value` read, not reactive).
- **Execution Order**: Multiple hooks of the same type within a component are executed in **FIFO (First-In, First-Out)** order. The DOM hooks run after all `onMount` callbacks.
- **Mechanism**: These hooks are **compiler macros**, not runtime functions — the compiler collects their callbacks from the top level of the component/page body and wires them into the generated connect/disconnect (or the page factory's `__lifecycle` record). The runtime exports are safe no-op stubs so imports resolve and stray calls (SSR, helper functions) do nothing. Consequently the hooks are only recognized as **top-level statements** of the component body; a call nested in a helper or conditional silently hits the no-op stub.
- **Element-Root Constraint (pages)**: `onResize`/`onVisibilityChange` need an element to observe. In a page/layout whose root is a fragment (or other non-element), they are a compile error — wrap the view in a container element. `onMediaQuery` has no such constraint. Components always observe their custom-element host.
- **Synchronous Constraint**: OTF Web component functions MUST be strictly synchronous. Using `async/await` in the component body means statements after an `await` are no longer top-level synchronous setup, so lifecycle hooks there silently fail. Async logic should be placed inside `onMount` or `$effect` instead.

### 7.2 Environment
- `isSSG`: A boolean flag. When `true`, `$effect` macros are ignored, and certain DOM operations (like `_clearChildren`) are skipped to allow for hydration-friendly output.

### 7.3 Error Handling & Boundaries
OTF Web does **not** use VDOM-style Error Boundaries (`<ErrorBoundary>`). Instead, it relies on a **Fine-Grained Failure** model:
- **Mount Errors**: An error thrown directly inside the component body or `connectedCallback` stops the component from mounting, bubbling up to the global error handler (`window.onerror`).
- **Effect Errors**: An error thrown inside an `_effect` kills *only that specific DOM binding's reactivity*. The rest of the component remains perfectly functional.
- **Global Handler**: The framework provides `OpenTFWeb.setErrorHandler((error, context) => {...})` to globally catch uncaught effect failures.
- **Local Recovery**: Developers can use the `$onError(err => {...})` macro (transformed to a try/catch inside effects) to gracefully catch local effect failures without crashing the application.

### 7.4 Async Data Loading (`resource()`)
Because component functions must be strictly synchronous, top-level `await` is forbidden. Client-side async data uses the **`resource()`** primitive (`@opentf/web`), which formalizes the fetch-into-signals Resource Pattern:

```jsx
import { resource } from "@opentf/web";

export function UserProfile({ id }) {
  const user = resource(
    () => id,                                   // reactive source — re-fetches when it changes
    (id, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
  );

  return (
    <div>
      {user.error ? <p>Error: {user.error.message}</p> :
       user.loading ? <p>Loading...</p> :
       <h1>{user.data.name}</h1>}
    </div>
  );
}
```

- **Shapes**: `resource(fetcher, options?)` fetches once; `resource(source, fetcher, options?)` re-fetches whenever the reactive `source` changes. `options.initial` seeds `data`.
- **State**: `{ data, loading, error, refetch }` — reactive getters backed by signals; read them in bindings/effects to subscribe. A rejection sets `error` and keeps the last good `data`.
- **Staleness**: each run aborts the previous run's `AbortController` (passed to the fetcher as `{ signal }`) and out-of-order resolutions are discarded, so late responses never overwrite newer data.
- **Conditional fetching**: a `source` returning `null`/`false` pauses the resource.
- **Server (SSG/SSR)**: nothing fetches and `loading` stays `true`, so pre-rendered HTML shows the loading branch — exactly what the client's first paint renders before its own fetch resolves, keeping hydration aligned.
- For data a page needs **at render time on the server**, use a route loader instead (Section 8.7).

The underlying pattern (a `$state` signal filled from a `fetch` inside `$effect`, rendered conditionally) remains valid for hand-rolled cases; `resource()` packages it with staleness, abort, and error handling.

---

## 8. Fullstack Routing

OTF Web uses a file-based router that supports layouts, dynamic segments, and client-side guards.

### 8.1 Directory Structure
- `app/`: The root of the routing system.
- `page.jsx`: Defines a route.
- `layout.jsx`: Defines a persistent wrapper for all routes in its directory and subdirectories.
- `404.jsx`: A global fallback page displayed when no other route matches the current pathname.

### 8.2 Dynamic Segments
- **Static**: `app/about/page.jsx` -> `/about`
- **Dynamic**: `app/posts/[id]/page.jsx` -> `/posts/:id`
- **Catch-all**: `app/docs/[...slug]/page.jsx` -> `/docs/*`

### 8.3 Layout Nesting
Layouts are recursively applied from the root `app/` directory down to the leaf `page.jsx`.
- Each layout receives a `children` prop containing the nested content (page or sub-layout).

### 8.4 Client-side Navigation
OTF Web utilizes the modern **Navigation API** (with fallback to the HTML5 History API) for seamless client-side transitions.
- **Persistence**: The layout tree is preserved across navigations. Only the components within the changing route segments are unmounted and replaced.
- **Scroll Restoration**: The router automatically restores scroll position on back/forward navigation and scrolls to top on new navigations (unless specified otherwise).

### 8.5 The `<Link>` Component
To enable client-side navigation, use the built-in `<Link>` component.
- **JSX**: `<Link href="/about">About Us</Link>`
- **Behavior**: Intercepts the click event, prevents full page reload, and triggers the internal router.
- **Active State**: Automatically applies an `aria-current="page"` attribute and a `.active` class when the current route matches the `href`.

### 8.6 Route Guards & Redirects
- **Guards**: Defined in `page.jsx` or `layout.jsx` via an exported `middleware` function.
- **Redirects**: Handled by throwing a `Redirect(path)` object or returning a `Response.redirect()` in middleware.

```javascript
export function middleware(request) {
  if (!auth.isLoggedIn) {
    throw Redirect("/login");
  }
}
```

### 8.7 Route Loaders (`loader.{js,ts}`)
A page gets server data from a **route loader** — a plain server module sibling to its `page.*` (the data analogue of a `route.*` API endpoint; see docs/DATA.md for the full design):

```
app/todos/page.jsx      → the page
app/todos/loader.js     → its server loader
```

```js
// app/todos/loader.js — never shipped to the client; DB/server imports are safe.
export default async function loader({ params, query, request, locale, locals }) {
  return db.todos.list();          // any JSON-serializable value
}
```

- **Signature**: default export (or named `loader`). `params` follows the `[param]`/`[...rest]` conventions (percent-decoded, catch-alls as arrays); `query` is the parsed query string (empty at SSG time); `request` is the live `Request` under `otfw serve`/dev and `undefined` at SSG prerender; `locale` is the active locale; `locals` is reserved.
- **Where it runs**: at build time under `otfw build --ssg`, per request under `otfw serve`, and on demand under `otfw dev` — never in the browser.
- **Reading the data**: the page reads the reactive **`router.data`**, like `router.params`. It is `undefined` when the route has no loader (or the loader 404'd).
- **The wire format**: first paint inlines the data as `<script type="application/json" id="__otfw_data">`; SPA navigation fetches `GET <path>/__data.json` (the same URL `--ssg` writes as a literal file next to each page's `index.html`, so static hosts serve it with no server). `__data.json` is a **reserved filename**.
- **Errors**: `notFound()` (from `@opentf/web/server`) renders the 404 page with HTTP 404 (and 404s the data endpoint); any other throw is a 500. The client treats a failed/404 data fetch as `data === undefined` and still commits the navigation.
- **Constraints (MVP)**: page-level only (no layout loaders); loaders do not run API `_middleware.*`; redirects and streaming are future work; a query-dependent loader needs `otfw serve` (static `__data.json` files are rendered with an empty query). A `loader.*` without a sibling `page.*` is a build error.
- **`getStaticPaths`** stays on the page module; a dynamic route with a loader still needs it to prerender.

---

## 9. Static Site Generation (SSG)

OTF Web is designed for high-performance static rendering, allowing the entire app to be pre-rendered into HTML at build time.

### 9.1 Build-time Rendering
The framework uses `linkedom` to provide a lightweight server-side DOM environment.
- **Shredding**: During SSG, the framework instantiates Web Components in the server DOM and manually triggers their `connectedCallback` to populate the HTML.
- **Data Reflection**: Properties set on components during SSG are reflected as attributes in the final HTML to ensure consistency.

### 9.2 Hydration
- **data-ssg="true"**: The root element is marked with this attribute if it was pre-rendered.
- **Client-side Pickup**: On the client, the framework detects `data-ssg` and skips initial rendering of static content.
- **Signal Hydration**: The framework identifies static content and skips the initial execution of effects that would otherwise re-render the pre-populated DOM.

### 9.3 Macro Behavior in SSG
- **`$effect()`**: The `$effect` macro is **never** executed during SSG to prevent client-only logic (like `fetch` or `localStorage`) from breaking the build.
- **`effect()` (Internal)**: To populate the DOM initially during the server build, `core/signals.js` intercepts internal `effect()` calls. During SSG, it executes the provided function *once* synchronously to trigger DOM bindings, and then returns a no-op dispose function, bypassing the reactivity engine.

### 9.4 Partial Hydration Strategy
OTF Web employs a **Selective Activation** strategy:
- **Marker**: Components that were SSG'd are marked with `data-ssg="true"`.
- **Skip Static**: On the client, the `connectedCallback` detects the marker. It skips the `_createDOM()` phase because the nodes already exist.
- **Hydrate Reactivity**: The component still runs its `_activate()` phase to register effects, but it checks if the current DOM state matches the signal's initial value to avoid unnecessary layout shifts.
- **Nested Hydration**: `data-ssg` is applied recursively. If a parent is SSG'd, its children are assumed to be SSG'd unless they explicitly opt-out.

---

## 10. Global State Management

OTF Web enables a "zero-boilerplate" store pattern using plain JS modules and signals, eliminating the need for complex state management libraries.

### 10.1 Philosophy: The Plain Object Store
A store in OTF Web is simply a plain JavaScript object that exposes signals as properties. Because OTF Web has no Virtual DOM and no component re-renders, it does not need selectors or complex subscription logic.

#### Definition Example
```javascript
// stores/counter.js
import { signal, computed } from "@opentf/web";

const _count = signal(0);

export const counterStore = {
  // Reactive properties (Signals)
  count: _count,
  double: computed(() => _count.value * 2),

  // Actions (Plain functions)
  increment: () => _count.value++,
  decrement: () => _count.value--
};
```

### 10.2 The Library Author Contract
To participate in the OTF Web reactive ecosystem, library authors (Forms, Query, Auth) should follow this simplified contract:
1. **Top-Level Signals**: Expose reactive state as top-level properties of a plain object, wrapped in `signal()`.
2. **Standard Data Structures**: Nested data (arrays of objects, etc.) should be kept as plain JS structures. OTF Web's `_mapped` helper will handle item-level reactivity.
3. **No Explicit Typing**: Because the compiler uses the single-level unwrap heuristic (the First-Access Rule), no `Signal<T>` typing or JSDoc is required. The compiler blindly unwraps the first property access, so the library author simply needs to structure the store such that those top-level accessed properties are the actual signals.
4. **Plain Actions**: Expose mutation methods as plain functions, not signals.

### 10.3 Comparison with VDOM Frameworks

| Aspect | Zustand / Redux | OTF Web |
|---|---|---|
| **Read State** | `useStore(selector)` | `$signal(store)` |
| **Write State** | `dispatch(action)` | Direct call: `store.action()` |
| **Derived State** | `useMemo` / `createSelector` | `computed()` in store |
| **Boilerplate** | High to Very High | Zero |
| **Re-render Scope** | Component-level | DOM-node level (Fine-grained) |
| **Provider Needed** | Yes | No |

### 10.4 Why Selectors are Irrelevant
In VDOM frameworks, selectors are used to prevent unnecessary component re-renders. In OTF Web, **components never re-render**. Instead, each DOM binding is its own fine-grained subscription:
- `_effect(() => el.textContent = app.count.value)` only updates that specific text node.
- Changing `app.user` will not affect the `app.count` binding, even if they are in the same component.
- **DOM granularity makes selective subscription irrelevant.**

---

## 11. API Routes

OTF Web provides a lightweight, standards-compliant server-side routing system for building APIs and backend logic.

### 11.1 Standard Web APIs
OTF Web strictly adheres to the standard **Fetch API** for server-side handlers. This ensures that API routes are portable across modern JS runtimes (Bun, Node 20+, Cloudflare Workers, Deno).

- **Input**: The handler receives a standard `Request` object.
- **Output**: The handler MUST return a standard `Response` object.

### 11.2 File-Based Dispatching
API routes are defined within the `app/api/` directory. The framework uses a file-based routing system mapped to the `/api/*` prefix.

- **Static Routes**: `app/api/status.js` → `/api/status`
- **Dynamic Routes**: `app/api/users/[id].js` → `/api/users/:id`

### 11.3 Method-Based Handlers
Routes are defined by exporting named functions corresponding to HTTP methods.

```javascript
// app/api/users.js

export async function GET(request) {
  // Use standard Request methods
  const { searchParams } = new URL(request.url);
  const users = await db.users.list();
  
  return Response.json(users);
}

// Example: Creating a new user
export async function POST(request) {
  const data = await request.json();
  const user = await db.users.create(data);
  
  return Response.json(user, { status: 201 });
}
```

### 11.4 OTF Web Regex Router & Runtime Adapters
OTF Web provides its own high-performance **Regex Router** to ensure consistent routing behavior across all deployment targets.

- **Internal Router**: The framework-provided router matches incoming URLs against compiled regex patterns and dispatches them to the appropriate named exports (`GET`, `POST`, etc.).
- **Platform-Agnostic**: Because the router is built into the OTF Web runtime, routing logic remains identical whether running on Bun, Node.js, or Edge workers.
- **HTTP Server Utilization**: OTF Web utilizes the native HTTP server of the underlying runtime (e.g., `Bun.serve` or Node's `http` module) via specialized **Adapters**. These adapters translate the platform's native request/response into the standard `Request`/`Response` objects used by OTF Web handlers.

### 11.5 Middleware & Errors
- **Shared Middleware**: Files named `_middleware.js` in the `app/api/` directory apply to all routes in that folder and subfolders.
- **Auth & Validation**: Cross-cutting concerns such as **Authentication**, **Authorization**, and **Request Validation** are handled exclusively via the middleware system.
- **Error Responses**: OTF Web encourages standard JSON error bodies:
  ```javascript
  return Response.json({ error: "Unauthorized", code: 401 }, { status: 401 });
  ```
- **Validation Libraries**: Recommended to use libraries like `zod` inside `_middleware.js` or handlers for schema-based validation.

---

## 12. DevTools & Debugging
Because OTF Web compiles components to standard Custom Elements, you can use native browser developer tools to inspect and debug your application.

### 12.1 Inspecting Reactive State
If you select a OTF Web component in the Elements panel, it is available as `$0` in the Console.
You can inspect the component's reactive state by accessing its internal signals:
```javascript
// View the actual signal objects holding the prop values
console.log($0._propsSignals);

// Read the current value of the 'name' prop
console.log($0._propsSignals.name.value);

// Force an update to the component manually
$0._propsSignals.name.value = "New Name";
```

### 12.2 Inspecting $state signals
Since `$state` variables are local to `connectedCallback`, they are not directly accessible on the element instance. To debug them:
1. Set a breakpoint in the component's `connectedCallback`.
2. Inspect the closure scope in the debugger.
3. Alternatively, use `$expose({ _debug: { count } })` to make them visible on the instance during development.

### 12.3 Debugging _mapped Lists
List items rendered via `_mapped` are "reified" into signals. To inspect an item's state:
1. Select the child element in the inspector.
2. In the console, use `$0.__waf_item` (if exposed by the runtime) to access the underlying signal for that list entry.

### 12.4 Effect Tracing
To trace which signal caused a DOM update:
1. Enable "Log Updates" in OTF Web Dev Mode.
2. The console will log: `[OTF Web] Effect fired: TextNode(12) updated via signal 'count'`.
3. Use the browser's "Performance" tab to see the call stack originating from a signal's `.value` setter.

---

## 13. Build Output
The OTF Web build pipeline (`waf build`) produces a production-ready bundle:
- **`dist/public/`**: Contains the static assets and the client-side JS bundle.
- **`dist/server/`**: Contains the SSR/API route handlers.
- **Code Splitting**: Each route is automatically code-split. The main bundle contains only the runtime and shared layouts; pages are loaded dynamically.
- **Asset Handling**: Images and fonts imported in JSX are hashed and moved to `dist/public/assets/`.

## 14. Environment Variables
OTF Web supports `.env` files with strict boundary enforcement:
- **Server-only**: Variables in `.env` are only available in API routes and during SSG.
- **Client-exposed**: Variables prefixed with `PUBLIC_` (e.g., `PUBLIC_API_URL`) are injected into the client bundle at build time.
- **Access**: Use `process.env` (Node/Bun) or `import.meta.env` (Vite-based environments).

---
