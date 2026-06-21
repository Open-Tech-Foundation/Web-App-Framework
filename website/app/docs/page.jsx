import CodeBlock from "../components/CodeBlock.jsx";
import Tabs from "../components/Tabs.jsx";

export default function DocsPage() {
  const installNpm = `npm create @opentf/web@latest my-app
cd my-app
npm install
npm run dev`;

  const installPnpm = `pnpm create @opentf/web my-app
cd my-app
pnpm install
pnpm run dev`;

  const installBun = `bun create @opentf/web my-app
cd my-app
bun install
bun run dev`;

  const webComponentsCode = `// This OTF Web component:
export function UserCard() { 
  return <div>User</div>; 
}

// Compiles to:
class UserCardElement extends HTMLElement { ... }
customElements.define("web-usercard", UserCardElement);`;

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

  const routerApiCode = `import { router } from "@opentf/web";

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

  const lifecycleCode = `import { onMount, onCleanup } from "@opentf/web";

export function Timer() {
  let time = $state(0);

  onMount(() => {
    const timer = setInterval(() => time++, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return <div>Time: {time}</div>;
}`;

  const testingCode = `import { expect, test } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import MyComponent from "./MyComponent.jsx";

test("increment counter", async () => {
  const { getByText } = render(MyComponent);
  const user = userEvent.setup();
  const btn = getByText("Count: 0");
  await user.click(btn);
  expect(btn.textContent).toBe("Count: 1");
});`;

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
          <h1 className="text-4xl font-bold tracking-tight text-[var(--text-main)]">Documentation</h1>
          <p className="text-xl text-[var(--text-muted)]">Everything you need to know to build high-performance web apps with OTF Web.</p>
        </div>

        <div id="introduction" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            Introduction
            <a href="#introduction" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            OTF Web is a revolutionary approach to building web applications. 
            Unlike React or Vue, it completely eliminates the Virtual DOM. Instead, it compiles your JSX directly into highly optimized, imperative native DOM operations. 
            Under the hood, every component is compiled into a standard Web Component, ensuring perfect interoperability with the web ecosystem.
          </p>
        </div>

        <div id="installation" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            Installation
            <a href="#installation" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)]">Start a new project instantly using our official scaffolding tool:</p>
          
          <Tabs tabs={[
            { label: 'npm', content: <CodeBlock code={installNpm} language="bash" /> },
            { label: 'pnpm', content: <CodeBlock code={installPnpm} language="bash" /> },
            { label: 'bun', content: <CodeBlock code={installBun} language="bash" /> }
          ]} />

          <p className="text-[var(--text-muted)] italic">This interactive tool will guide you through choosing a styling solution and including optional framework modules.</p>
        </div>

        <div id="architecture" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🏗️ Architecture
            <a href="#architecture" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed mb-4">
            OTF Web is built on three main pillars that ensure maximum performance and developer experience:
          </p>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-[var(--text-main)]">
              <span className="text-emerald-500">✅</span>
              <strong>Statically Analyzed JSX</strong>
            </li>
            <li className="flex items-center gap-3 text-[var(--text-main)]">
              <span className="text-emerald-500">✅</span>
              <strong>Fine-grained Signals</strong>
            </li>
            <li className="flex items-center gap-3 text-[var(--text-main)]">
              <span className="text-emerald-500">✅</span>
              <strong>Native Web Components</strong>
            </li>
          </ul>
          <div className="grid md:grid-cols-3 gap-6 mt-6">
            <div className="p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
              <h4 className="font-bold mb-2">⚡ No Hydration</h4>
              <p className="text-sm text-[var(--text-muted)]">HTML is sent to the client and becomes immediately interactive. No expensive re-render on load.</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
              <h4 className="font-bold mb-2">🌐 Web Standards</h4>
              <p className="text-sm text-[var(--text-muted)]">Every component is a standard Custom Element. Use them anywhere, even in plain HTML.</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]">
              <h4 className="font-bold mb-2">🎯 Signal Driven</h4>
              <p className="text-sm text-[var(--text-muted)]">Updates are O(1). Changing a value only updates the specific DOM node bound to it.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 🧩 CORE CONCEPTS */}
      <section className="space-y-12">
        <div id="zero-vdom" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            ⭕ Zero-VDOM Architecture
            <a href="#zero-vdom" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            When you write JSX in OTF Web, it is not transformed into `React.createElement` calls. 
            Instead, our compiler statically analyzes your templates and converts them into `document.createElement`, `appendChild`, and direct attribute assignments. 
            When state changes, only the specific DOM node bound to that state is updated. No diffing, no reconciliation loop.
          </p>
        </div>

        <div id="web-components" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            📦 Web Components Under the Hood
            <a href="#web-components" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Every capitalized function in OTF Web that contains JSX syntax (e.g., `function Button()`) is automatically compiled into a native custom element (`{"<web-button>"}`). 
            Regular capitalized utility functions that do not return JSX are left untouched.
            This means you get style encapsulation and native lifecycle management for free on your UI components.
          </p>
          <CodeBlock code={webComponentsCode} />
        </div>

        <div id="props" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            📥 Component Props
            <a href="#props" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Props are passed down just like in React, but they are fully reactive. If a parent updates a prop, the child component automatically updates without re-rendering the entire component.
          </p>
          <CodeBlock code={propsCode} />
        </div>
      </section>

      {/* 3. 🧪 REACTIVITY */}
      <section className="space-y-12">
        <div id="state" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            ✨ The $state Macro
            <a href="#state" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            State management in OTF Web is powered by signals, but you never have to deal with `.value`. The compiler automatically tracks variables declared with `$state()` and injects reactivity seamlessly.
          </p>
          <CodeBlock 
            code={stateCode} 
            compiled={`let count = _signal(0);\n\n// Compiler transforms reassignments to .value\ncount.value++;\ncount.value = 10;`}
          />
        </div>

        <div id="derived" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🧬 The $derived Macro
            <a href="#derived" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Use `$derived` to create computed values that automatically update whenever their dependencies change. These are cached and only re-evaluate when necessary.
          </p>
          <CodeBlock code={derivedCode} />
        </div>

        <div id="effect" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🎬 The $effect Macro
            <a href="#effect" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            To run side effects when state changes (like fetching data or logging), use `$effect`. It automatically tracks which states you read inside the function.
          </p>
          <CodeBlock code={effectCode} />
        </div>
      </section>

      {/* 4. 🛣️ ROUTING */}
      <section className="space-y-12">
        <div id="file-routing" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            📂 File-based Routing
            <a href="#file-routing" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            OTF Web uses a file-system based router. Any file named `page.jsx` inside the `app/` directory becomes a route.
          </p>
          <ul className="list-disc pl-6 space-y-2 text-[var(--text-muted)]">
            <li><code className="text-sm bg-[var(--bg-surface)] px-1 rounded">app/page.jsx</code> → <code className="text-sm text-[var(--accent)]">/</code></li>
            <li><code className="text-sm bg-[var(--bg-surface)] px-1 rounded">app/about/page.jsx</code> → <code className="text-sm text-[var(--accent)]">/about</code></li>
            <li><code className="text-sm bg-[var(--bg-surface)] px-1 rounded">app/blog/[id]/page.jsx</code> → <code className="text-sm text-[var(--accent)]">/blog/:id</code> (Dynamic Route)</li>
            <li><code className="text-sm bg-[var(--bg-surface)] px-1 rounded">app/docs/[...slug]/page.jsx</code> → <code className="text-sm text-[var(--accent)]">/docs/*</code> (Catch-all Route)</li>
          </ul>
        </div>

        <div id="layouts" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🖼️ Layouts
            <a href="#layouts" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Use `layout.jsx` to wrap your pages with shared UI like navigation bars or sidebars. Layouts can be nested indefinitely. The matched child route is passed via `props.children`.
          </p>
          <CodeBlock code={layoutsCode} />
        </div>

        <div id="dynamic-routes" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🔗 Dynamic Routes
            <a href="#dynamic-routes" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Create dynamic routes by using square brackets in filenames. The parameters are available via `router.params`.
          </p>
          <CodeBlock code={`// app/user/[id]/page.jsx\nexport default function UserPage() {\n  return (\n    <div>\n      <h1>User Profile</h1>\n      <p>Viewing user: {router.params.id}</p>\n    </div>\n  );\n}`} />
        </div>

        <div id="router-api" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            ⚙️ Router API
            <a href="#router-api" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            The global `router` singleton gives you programmatic control over navigation and reactive access to URL state.
          </p>
          <CodeBlock code={routerApiCode} />
        </div>
      </section>

      {/* 5. 🛠️ ADVANCED */}
      <section className="space-y-12">
        <div id="lists" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            📜 List Rendering
            <a href="#lists" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Use standard JavaScript `.map()` to render lists. OTF Web automatically wraps the mapping in a reactive execution context, meaning the list updates precisely when the array mutates.
          </p>
          <CodeBlock code={listsCode} />
        </div>

        <div id="conditionals" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🔀 Conditional Rendering
            <a href="#conditionals" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Use standard logical operators (`&&`) or ternary expressions (`? :`) for conditional UI. OTF Web will intelligently mount and unmount these DOM fragments dynamically.
          </p>
          <CodeBlock code={conditionalsCode} />
        </div>

        <div id="lifecycle" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            ⏱️ Lifecycle Hooks
            <a href="#lifecycle" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            If you need to interact with the DOM after the component mounts, or clean up intervals when it unmounts, use `onMount` and `onCleanup`.
          </p>
          <CodeBlock code={lifecycleCode} />
        </div>

        <div id="refs" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🎯 DOM References ($ref & $expose)
            <a href="#refs" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            To access native DOM nodes or component instances, use the `$ref` macro. To customize the API your component exposes to a ref, use `$expose`.
          </p>
          <CodeBlock code={refsCode} />
        </div>

        <div id="global-state" className="space-y-4 scroll-mt-24 group">
          <h2 className="text-2xl font-bold border-b border-[var(--border)] pb-2 flex items-center gap-2">
            🌎 Global State Management
            <a href="#global-state" className="opacity-0 group-hover:opacity-100 text-accent text-sm transition-opacity">#</a>
          </h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Since OTF Web reactivity is based on standard signals, global state is as simple as exporting a signal from a shared file.
          </p>
          <CodeBlock code={`// store.js\n// No imports needed! The compiler handles the macro\nexport const user = $state({ name: "Guest" });\n\n// component.jsx\nimport { user } from "./store";\n\nexport function Profile() {\n  // Access directly, no .value needed\n  return <div>Hello, {user.name}</div>;\n}`} />
        </div>
      </section>


      {/* 7. 🧪 TESTING */}
      <section id="testing" className="space-y-8 border-t border-[var(--border)] pt-12 scroll-mt-24">
        <div className="space-y-4">
          <h2 className="text-3xl font-bold text-[var(--text-main)]">Testing 🧪</h2>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Reliable applications require reliable tests. The official <code className="text-accent">@opentf/web-test</code> package provides a lightweight, "React Testing Library" style utility for testing framework components.
          </p>
          <p className="text-[var(--text-muted)] leading-relaxed">
            It integrates with <strong>Bun's test runner</strong> and uses <strong>Happy DOM</strong> for a high-performance virtual browser environment.
          </p>
          
          <div className="bg-[var(--bg-surface)] p-6 rounded-xl border border-[var(--border)] space-y-4">
            <h4 className="font-bold text-[var(--text-main)]">Quick Setup</h4>
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-muted)]">1. Install dependencies:</p>
              <pre className="bg-slate-900 text-slate-300 p-3 rounded-lg text-xs">bun add -d @opentf/web-test</pre>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-muted)]">2. Add to your <code className="text-accent">bunfig.toml</code>:</p>
              <pre className="bg-slate-900 text-slate-300 p-3 rounded-lg text-xs">
{`[test]
preload = ["@opentf/web-test/setup"]`}
              </pre>
            </div>
          </div>

          <CodeBlock code={testingCode} />
        </div>
      </section>

      {/* 8. ⚙️ API REFERENCE */}
      <section className="space-y-12 border-t border-[var(--border)] pt-12">
        <h2 className="text-3xl font-bold text-[var(--text-main)]">API Reference 📖</h2>

        <div id="api-macros" className="space-y-4 scroll-mt-24">
          <h3 className="text-xl font-bold text-[var(--text-main)]">Macros</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2 font-bold text-[var(--text-main)]">Name</th>
                  <th className="py-2 font-bold text-[var(--text-main)]">Description</th>
                </tr>
              </thead>
              <tbody className="text-sm text-[var(--text-muted)]">
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">$state(init)</td>
                  <td className="py-3">Creates a reactive state variable. Auto-unwrapped by compiler.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">$derived(fn)</td>
                  <td className="py-3">Creates a computed signal that updates when dependencies change.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">$effect(fn)</td>
                  <td className="py-3">Runs side effects on state changes. Returns a cleanup function.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">$ref()</td>
                  <td className="py-3">Creates a reference to a DOM element or component.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">$expose(api)</td>
                  <td className="py-3">Defines the public API of a component accessible via a ref.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div id="api-hooks" className="space-y-4 scroll-mt-24">
          <h3 className="text-xl font-bold text-[var(--text-main)]">Hooks</h3>
          <ul className="space-y-4">
            <li>
              <div className="font-mono text-accent">onMount(callback)</div>
              <p className="text-sm text-[var(--text-muted)]">Executes when the component is inserted into the DOM.</p>
            </li>
            <li>
              <div className="font-mono text-accent">onCleanup(callback)</div>
              <p className="text-sm text-[var(--text-muted)]">Executes before the component is removed from the DOM.</p>
            </li>
          </ul>
        </div>

        <div id="api-router" className="space-y-4 scroll-mt-24">
          <h3 className="text-xl font-bold text-[var(--text-main)]">Router</h3>
          <p className="text-sm text-[var(--text-muted)]">The `router` object provides reactive access to the current URL.</p>
          <ul className="list-disc pl-6 text-sm text-[var(--text-muted)] space-y-1">
            <li><code className="text-accent">router.pathname</code>: Current path (reactive)</li>
            <li><code className="text-accent">router.params</code>: Dynamic route parameters</li>
            <li><code className="text-accent">router.query</code>: URL search parameters</li>
            <li><code className="text-accent">router.push(url)</code>: Navigate to a new URL</li>
          </ul>
        </div>

        <div id="api-attributes" className="space-y-4 scroll-mt-24">
          <h3 className="text-xl font-bold text-[var(--text-main)]">Elements & Attributes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2 font-bold text-[var(--text-main)]">Attribute</th>
                  <th className="py-2 font-bold text-[var(--text-main)]">Handling</th>
                </tr>
              </thead>
              <tbody className="text-sm text-[var(--text-muted)]">
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">className / class</td>
                  <td className="py-3">Mapped to native <code className="bg-[var(--bg-surface)] px-1 rounded">className</code> property.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">style</td>
                  <td className="py-3">Accepts an object. Mapped via <code className="bg-[var(--bg-surface)] px-1 rounded">Object.assign(el.style, ...)</code>.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">on[Event]</td>
                  <td className="py-3">Standard event listeners (e.g. <code className="bg-[var(--bg-surface)] px-1 rounded">onclick</code>).</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">ref</td>
                  <td className="py-3">Binds the element to a variable declared with <code className="bg-[var(--bg-surface)] px-1 rounded">$ref()</code>.</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-3 font-mono text-accent">{`{...props}`}</td>
                  <td className="py-3">Spreads an object of attributes onto the element. Supports reactive signals.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  );
}
