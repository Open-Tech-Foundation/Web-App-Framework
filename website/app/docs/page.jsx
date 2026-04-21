import CodeBlock from "../components/CodeBlock.jsx";

export default function DocsPage() {
  const installationCode = `git clone https://github.com/Open-Tech-Foundation/waf-core my-app
cd my-app
bun install
bun dev`;

  const webComponentsCode = `// This WAF component:
export function UserCard() { 
  return <div>User</div>; 
}

// Compiles to:
class UserCardElement extends HTMLElement { ... }
customElements.define("waf-usercard", UserCardElement);`;

  const propsCode = `export function Greeting(props) {
  // props.name is reactive!

  return <h1>Hello, {props.name}!</h1>;
}`;

  const stateCode = `let count = $state(0);

// Just reassign or mutate directly
count++;
count = 10;`;

  const derivedCode = `let count = $state(2);
const doubled = $derived(() => count * 2);
// doubled is 4, automatically becomes 6 if count changes to 3`;

  const effectCode = `$effect(() => {
  console.log(\`The count is now \${count}\`);
});`;

  const layoutsCode = `export default function DashboardLayout(props) {
  
  return (
    <div className="dashboard">
      <Sidebar />
      <main>{props.children}</main>
    </div>
  );
}`;

  const routerApiCode = `import { router } from "@waf/router";

// Reactive signals
<div>Current Path: {router.pathname}</div>
<div>Search: {router.searchParams.get("q")}</div>

// Navigation methods
<button onclick={() => router.push('/login')}>Login</button>
<button onclick={() => router.replace('/home')}>Home</button>`;

  const listsCode = `let users = $state(["Alice", "Bob", "Charlie"]);

return (
  <ul>
    {users.map(u => <li>{u}</li>)}
  </ul>
);`;

  const conditionalsCode = `let isLoggedIn = $state(false);

return (
  <div>
    {isLoggedIn ? <Dashboard /> : <Login />}
    {!isLoggedIn && <span>Please sign in</span>}
  </div>
);`;

  const lifecycleCode = `import { onMount, onCleanup } from "waf";

export function Timer() {
  let time = $state(0);

  onMount(() => {
    const timer = setInterval(() => time++, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return <div>Time: {time}</div>;
}`;

  const refsCode = `function CustomInput() {
  const input = $ref();
  const focus = () => input.focus();

  // Expose methods to parents
  $expose({ focus });

  return <input ref={input} />;
}`;

  return (
    <div className="space-y-24 pb-24">
      
      {/* 1. GETTING STARTED */}
      <section className="space-y-12">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Documentation</h1>
          <p className="text-xl text-slate-500">Everything you need to know to build high-performance web apps with WAF.</p>
        </div>

        <div id="introduction" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2 flex items-center gap-2">
            Introduction
            <a href="#introduction" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-slate-600 leading-relaxed">
            WAF (Web Application Framework) is a revolutionary approach to building web applications. 
            Unlike React or Vue, it completely eliminates the Virtual DOM. Instead, it compiles your JSX directly into highly optimized, imperative native DOM operations. 
            Under the hood, every component is compiled into a standard Web Component, ensuring perfect interoperability with the web ecosystem.
          </p>
        </div>

        <div id="installation" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2 flex items-center gap-2">
            Installation
            <a href="#installation" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-slate-600">Currently, WAF is in an experimental phase. You can start a new project by cloning the core repository:</p>
          <CodeBlock code={installationCode} language="bash" />
        </div>
      </section>

      {/* 2. CORE CONCEPTS */}
      <section className="space-y-12">
        <div id="zero-vdom" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2 flex items-center gap-2">
            Zero-VDOM Architecture
            <a href="#zero-vdom" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-slate-600 leading-relaxed">
            When you write JSX in WAF, it is not transformed into `React.createElement` calls. 
            Instead, our compiler statically analyzes your templates and converts them into `document.createElement`, `appendChild`, and direct attribute assignments. 
            When state changes, only the specific DOM node bound to that state is updated. No diffing, no reconciliation loop.
          </p>
        </div>

        <div id="web-components" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Web Components Under the Hood</h2>
          <p className="text-slate-600 leading-relaxed">
            Every capitalized function in WAF that contains JSX syntax (e.g., `function Button()`) is automatically compiled into a native custom element (`{"<waf-button>"}`). 
            Regular capitalized utility functions that do not return JSX are left untouched.
            This means you get style encapsulation and native lifecycle management for free on your UI components.
          </p>
          <CodeBlock code={webComponentsCode} />
        </div>

        <div id="props" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Component Props</h2>
          <p className="text-slate-600 leading-relaxed">
            Props are passed down just like in React, but they are fully reactive. If a parent updates a prop, the child component automatically updates without re-rendering the entire component.
          </p>
          <CodeBlock code={propsCode} />
        </div>
      </section>

      {/* 3. REACTIVITY */}
      <section className="space-y-12">
        <div id="state" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2 flex items-center gap-2">
            The $state Macro
            <a href="#state" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-slate-600 leading-relaxed">
            State management in WAF is powered by signals, but you never have to deal with `.value`. The compiler automatically tracks variables declared with `$state()` and injects reactivity seamlessly.
          </p>
          <CodeBlock 
            code={stateCode} 
            compiled={`let count = _signal(0);\n\n// Compiler transforms reassignments to .value\ncount.value++;\ncount.value = 10;`}
          />
        </div>

        <div id="derived" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">The $derived Macro</h2>
          <p className="text-slate-600 leading-relaxed">
            Use `$derived` to create computed values that automatically update whenever their dependencies change. These are cached and only re-evaluate when necessary.
          </p>
          <CodeBlock code={derivedCode} />
        </div>

        <div id="effect" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">The $effect Macro</h2>
          <p className="text-slate-600 leading-relaxed">
            To run side effects when state changes (like fetching data or logging), use `$effect`. It automatically tracks which states you read inside the function.
          </p>
          <CodeBlock code={effectCode} />
        </div>
      </section>

      {/* 4. ROUTING */}
      <section className="space-y-12">
        <div id="file-routing" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">File-based Routing</h2>
          <p className="text-slate-600 leading-relaxed">
            WAF uses a file-system based router. Any file named `page.jsx` inside the `app/` directory becomes a route.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-slate-600">
            <li><code className="text-sm bg-slate-100 px-1 rounded">app/page.jsx</code> → <code className="text-sm text-[#ff851b]">/</code></li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">app/about/page.jsx</code> → <code className="text-sm text-[#ff851b]">/about</code></li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">app/blog/[id]/page.jsx</code> → <code className="text-sm text-[#ff851b]">/blog/:id</code> (Dynamic Route)</li>
            <li><code className="text-sm bg-slate-100 px-1 rounded">app/docs/[...slug]/page.jsx</code> → <code className="text-sm text-[#ff851b]">/docs/*</code> (Catch-all Route)</li>
          </ul>
        </div>

        <div id="layouts" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Layouts</h2>
          <p className="text-slate-600 leading-relaxed">
            Use `layout.jsx` to wrap your pages with shared UI like navigation bars or sidebars. Layouts can be nested indefinitely. The matched child route is passed via `props.children`.
          </p>
          <CodeBlock code={layoutsCode} />
        </div>

        <div id="router-api" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Router API</h2>
          <p className="text-slate-600 leading-relaxed">
            The global `router` singleton gives you programmatic control over navigation and reactive access to URL state.
          </p>
          <CodeBlock code={routerApiCode} />
        </div>
      </section>

      {/* 5. UI PATTERNS */}
      <section className="space-y-12">
        <div id="lists" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">List Rendering</h2>
          <p className="text-slate-600 leading-relaxed">
            Use standard JavaScript `.map()` to render lists. WAF automatically wraps the mapping in a reactive execution context, meaning the list updates precisely when the array mutates.
          </p>
          <CodeBlock code={listsCode} />
        </div>

        <div id="conditionals" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Conditional Rendering</h2>
          <p className="text-slate-600 leading-relaxed">
            Use standard logical operators (`&&`) or ternary expressions (`? :`) for conditional UI. WAF will intelligently mount and unmount these DOM fragments dynamically.
          </p>
          <CodeBlock code={conditionalsCode} />
        </div>

        <div id="lifecycle" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">Lifecycle Hooks</h2>
          <p className="text-slate-600 leading-relaxed">
            If you need to interact with the DOM after the component mounts, or clean up intervals when it unmounts, use `onMount` and `onCleanup`.
          </p>
          <CodeBlock code={lifecycleCode} />
        </div>

        <div id="refs" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold border-b border-slate-100 pb-2">DOM References ($ref & $expose)</h2>
          <p className="text-slate-600 leading-relaxed">
            To access native DOM nodes or component instances, use the `$ref` macro. To customize the API your component exposes to a ref, use `$expose`.
          </p>
          <CodeBlock code={refsCode} />
          <p className="text-slate-600 leading-relaxed mt-4">
            Just like `$state`, variables declared with `$ref` are automatically handled by the compiler. You never need to manually access `.value` to interact with the referenced element.
          </p>
        </div>
      </section>

    </div>
  );
}
