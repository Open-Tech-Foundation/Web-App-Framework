import { Link } from "@opentf/web";
import CodeBlock from "./components/CodeBlock.jsx";
import Counter from "./components/Counter.jsx";
import TodoList from "./components/TodoList.jsx";

export default function HomePage() {
  const counterCode = `export default function Counter() {
  let count = $state(0);

  return (
    <div className="flex gap-4 items-center">
      <button onclick={() => count--}>-</button>
      <span className="text-2xl font-bold">{count}</span>
      <button onclick={() => count++}>+</button>
    </div>
  );
}`;

  const counterCompiled = `class CounterElement extends HTMLElement {
  connectedCallback() {
    let count = _signal(0);
    const rootElement = (() => {
      const el0 = document.createElement("div");
      const el1 = document.createElement("button");
      el1.onclick = () => count.value--;
      el1.textContent = "-";
      el0.appendChild(el1);
      
      const el3 = document.createElement("span");
      _renderDynamic(el3, () => count.value);
      el0.appendChild(el3);
      
      const el4 = document.createElement("button");
      el4.onclick = () => count.value++;
      el4.textContent = "+";
      el0.appendChild(el4);
      return el0;
    })();
    this.appendChild(rootElement);
  }
}
customElements.define("web-counter", CounterElement);`;

  const todoCode = `export default function TodoList() {
  let todos = $state([{ id: 1, text: "Learn OTF Web", done: false }]);
  
  const toggle = (id) => {
    todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
  };
  
  return (
    <ul className="space-y-2">
      {todos.map(todo => (
        <li key={todo.id}>
          <input type="checkbox" checked={todo.done} onchange={() => toggle(todo.id)} />
          <span className={todo.done ? "line-through" : ""}>{todo.text}</span>
        </li>
      ))}
    </ul>
  );
}`;

  const todoCompiled = `class TodoListElement extends HTMLElement {
  connectedCallback() {
    let todos = _signal([{ id: 1, text: "Learn OTF Web", done: false }]);
    const toggle = id => {
      todos.value = todos.value.map(t => t.id === id ? { ...t, done: !t.done } : t);
    };
    const rootElement = (() => {
      const el0 = document.createElement("ul");
      _renderDynamic(el0, () => todos.value.map(todo => (() => {
        const el0 = document.createElement("li");
        el0._key = todo.id;
        const el1 = document.createElement("input");
        el1.setAttribute("type", "checkbox");
        _effect(() => el1.checked = todo.done);
        el1.onchange = () => toggle(todo.id);
        el0.appendChild(el1);
        const el2 = document.createElement("span");
        _effect(() => el2.className = todo.done ? "line-through" : "");
        _renderDynamic(el2, () => todo.text);
        el0.appendChild(el2);
        return el0;
      })()));
      return el0;
    })();
    this.appendChild(rootElement);
  }
}
customElements.define("web-todolist", TodoListElement);`;

  return (
    <div className="flex-1 max-w-6xl mx-auto px-8 w-full pb-24">
      {/* Hero Section */}
      <section className="py-24 text-center max-w-3xl mx-auto space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20 rounded-full text-[10px] font-bold uppercase tracking-wider">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]"></span>
          </span>
          Experimental
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-[var(--text-main)] leading-[1.1]">
          The <span className="text-accent">native-first</span> framework for <br />
          modern web apps.
        </h1>

        <p className="text-xl text-[var(--text-muted)] leading-relaxed">
          A high-performance, zero-VDOM framework that compiles JSX to native DOM.
          <br />
          Built with signals and standard Web Components.
        </p>

        <div className="flex justify-center gap-4 pt-4">
          <Link href="/docs" className="transition-all active:scale-95">
            <span className="inline-flex items-center justify-center bg-[var(--text-main)] text-[var(--bg-main)] px-8 py-3 rounded-xl font-bold hover:opacity-90 shadow-md gap-2">
              Get Started 🚀
            </span>
          </Link>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <div className="p-6 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] space-y-3 transition-colors">
          <div className="text-3xl">⚡️</div>
          <h3 className="font-bold text-[var(--text-main)]">Zero VDOM</h3>
          <p className="text-sm text-[var(--text-muted)]">Eliminate diffing overhead. OTF Web maps state changes directly to the DOM for unmatched runtime performance.</p>
        </div>

        <div className="p-6 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] space-y-3 transition-colors">
          <div className="text-3xl">🧩</div>
          <h3 className="font-bold text-[var(--text-main)]">Native Components</h3>
          <p className="text-sm text-[var(--text-muted)]">Interoperate with the entire web ecosystem. Every OTF Web component is a standard Web Component.</p>
        </div>

        <div className="p-6 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] space-y-3 transition-colors">
          <div className="text-3xl">⚛️</div>
          <h3 className="font-bold text-[var(--text-main)]">Atomic Reactivity</h3>
          <p className="text-sm text-[var(--text-muted)]">Powered by $state macro. Fine-grained updates ensure only the specific parts of the UI change when data does.</p>
        </div>

        <div className="p-6 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] space-y-3 transition-colors">
          <div className="text-3xl">🛣️</div>
          <h3 className="font-bold text-[var(--text-main)]">File-based Routing</h3>
          <p className="text-sm text-[var(--text-muted)]">A familiar, powerful routing system supporting nested layouts, dynamic segments, and catch-all paths.</p>
        </div>
      </section>
      {/* Capabilities Matrix */}
      <section className="py-24 space-y-12">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Capabilities & Roadmap</h2>
          <p className="text-[var(--text-muted)] max-w-2xl mx-auto">A transparent look at our current features and future direction.</p>
        </div>

        <div className="max-w-4xl mx-auto overflow-hidden bg-[var(--bg-main)] border border-[var(--border)] rounded-3xl shadow-sm transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border)] transition-colors">
                  <th className="px-8 py-4 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Feature</th>
                  <th className="px-8 py-4 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Status</th>
                  <th className="px-8 py-4 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">CSR (Client Rendering)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">High-performance SPA engine ready for production.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Zero-VDOM Updates</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Standard JSX support, almost on par with industry leaders. Hardening with massive test coverage.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Reactive Macros</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Boilerplate-free reactivity system ($state, $derived, $effect) built on fine-grained Signals.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Performance Defaults</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Minimal core runtime and efficient updates for maximum speed.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Route-level Splitting</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Automatic code splitting for every route segment.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Lazy Loading</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Fine-grained component-level lazy loading and prefetching.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">File-based Router</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Next.js style directory routing with client-side navigation.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Nested Layouts</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Hierarchical UI structures with persistent state across route changes.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Route Guards</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Protect routes with custom logic and redirection.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Middleware</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Advanced request processing and transformations.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Enterprise Forms</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Deep-proxy reactive forms with async validation.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Testing Library</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">React Testing Library-equivalent utilities for native components.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">CLI Scaffolding Tool</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Get started instantly with our `create-web` project generator.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Security First</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">XSS-safe by default (no innerHTML) and built-in route protection.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">SSR (Server Rendering)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Planned for unified full-stack support.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">TypeScript Support</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">First-class type safety and TSX support across the ecosystem.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">MDX Support</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Integrated MDX engine for high-performance documentation and blogs.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Devtool Ecosystem</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Browser extension with component, state, and network tracing capabilities.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Internationalization (i18n)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Routing-level i18n, translation loading, and locale-aware formatting.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Accessibility (a11y)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Built-in ARIA helpers, a11y checks, and keyboard navigation defaults.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Dev Error Overlay</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Rich error details and interactive stack traces for a superior dev experience.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">High-speed Compiler</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Future migration to a low-level, ultra-fast compilation engine.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">SSG (Static Generation)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">High-performance static site engine.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">API Routes</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Integrated server-side API endpoints for a unified full-stack experience.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Data Fetching</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Integrated client-side fetching with caching and sync.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">HMR (Hot Reloading)</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Real-time dev experience via Vite/Bun.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">CSS Modules</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Native support for scoped styling via Vite.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">TailwindCSS</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5" d="M5 13l4 4L19 7"></path></svg>
                      Supported
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)]">Seamless integration with Utility-first CSS via Vite.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Image Optimization</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Automated image processing and lazy-loading.</td>
                </tr>
                <tr>
                  <td className="px-8 py-5 font-bold text-[var(--text-main)]">Font Optimization</td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold uppercase tracking-wider border border-amber-100">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Planned
                    </span>
                  </td>
                  <td className="px-8 py-5 text-sm text-[var(--text-muted)] italic">Zero-layout-shift font delivery.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Demos Section */}
      <section className="py-24 space-y-24">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">Built for developers.</h2>
          <p className="text-[var(--text-muted)] max-w-2xl mx-auto">See how easy it is to build reactive applications with OTF Web. No boilerplate, just standard JavaScript and JSX.</p>
        </div>

        {/* Counter Demo */}
        <div className="grid md:grid-cols-2 gap-8 items-center bg-[var(--bg-main)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm transition-colors">
          <div className="p-12 border-b md:border-b-0 md:border-r border-[var(--border)] bg-[var(--bg-surface)] flex flex-col items-center justify-center min-h-[300px] transition-colors">
            <div className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest mb-8">Live Preview</div>
            <Counter />
          </div>
          <div className="p-8">
            <CodeBlock code={counterCode} compiled={counterCompiled} />
          </div>
        </div>

        {/* Todo List Demo */}
        <div className="grid md:grid-cols-2 gap-8 items-center bg-[var(--bg-main)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm transition-colors">
          <div className="p-8 order-2 md:order-1">
            <CodeBlock code={todoCode} compiled={todoCompiled} />
          </div>
          <div className="p-12 border-t md:border-t-0 md:border-l border-[var(--border)] bg-[var(--bg-surface)] flex flex-col items-center justify-center min-h-[400px] order-1 md:order-2 transition-colors">
            <div className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest mb-8">Live Preview</div>
            <TodoList />
          </div>
        </div>
      </section>
    </div>
  );
}
