import Link from "../../framework/router/Link.wc.jsx";
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
customElements.define("waf-counter", CounterElement);`;

  const todoCode = `export default function TodoList() {
  let todos = $state([{ id: 1, text: "Learn WAF", done: false }]);
  
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
    let todos = _signal([{ id: 1, text: "Learn WAF", done: false }]);
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
customElements.define("waf-todolist", TodoListElement);`;

  return (
    <div className="flex-1 max-w-6xl mx-auto px-8 w-full pb-24">
      {/* Hero Section */}
      <section className="py-24 text-center max-w-3xl mx-auto space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#ff851b]/10 text-[#ff851b] border border-[#ff851b]/20 rounded-full text-[10px] font-bold uppercase tracking-wider">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff851b] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff851b]"></span>
          </span>
          Experimental
        </div>
        
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 leading-[1.1]">
          The minimal framework for <br />
          <span className="text-accent">modern web apps.</span>
        </h1>
        
        <p className="text-xl text-slate-500 leading-relaxed">
          WAF is a high-performance, zero-VDOM framework that compiles JSX to native DOM. 
          Built with signals and standard Web Components.
        </p>

        <div className="flex justify-center gap-4 pt-4">
          <Link href="/docs" className="inline-flex items-center justify-center bg-black text-white px-6 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md active:scale-95">
            Get Started
          </Link>
          <a href="https://github.com/Open-Tech-Foundation" className="inline-flex items-center justify-center bg-white text-slate-900 border border-slate-200 px-6 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-95">
            View on GitHub
          </a>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
          <div className="text-3xl">⚡️</div>
          <h3 className="font-bold text-slate-900">Zero VDOM</h3>
          <p className="text-sm text-slate-500">Eliminate diffing overhead. WAF maps state changes directly to the DOM for unmatched runtime performance.</p>
        </div>
        
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
          <div className="text-3xl">🧩</div>
          <h3 className="font-bold text-slate-900">Native Components</h3>
          <p className="text-sm text-slate-500">Interoperate with the entire web ecosystem. Every WAF component is a standard Web Component.</p>
        </div>

        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
          <div className="text-3xl">⚛️</div>
          <h3 className="font-bold text-slate-900">Atomic Reactivity</h3>
          <p className="text-sm text-slate-500">Powered by $state macro. Fine-grained updates ensure only the specific parts of the UI change when data does.</p>
        </div>

        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
          <div className="text-3xl">🛣️</div>
          <h3 className="font-bold text-slate-900">File-based Routing</h3>
          <p className="text-sm text-slate-500">A familiar, powerful routing system supporting nested layouts, dynamic segments, and catch-all paths.</p>
        </div>
      </section>

      {/* Demos Section */}
      <section className="py-24 space-y-24">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tight">Built for developers.</h2>
          <p className="text-slate-500 max-w-2xl mx-auto">See how easy it is to build reactive applications with WAF. No boilerplate, just standard JavaScript and JSX.</p>
        </div>

        {/* Counter Demo */}
        <div className="grid md:grid-cols-2 gap-8 items-center bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-12 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 flex flex-col items-center justify-center min-h-[300px]">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-8">Live Preview</div>
            <Counter />
          </div>
          <div className="p-8">
            <CodeBlock code={counterCode} compiled={counterCompiled} />
          </div>
        </div>

        {/* Todo List Demo */}
        <div className="grid md:grid-cols-2 gap-8 items-center bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="p-8 order-2 md:order-1">
            <CodeBlock code={todoCode} compiled={todoCompiled} />
          </div>
          <div className="p-12 border-t md:border-t-0 md:border-l border-slate-200 bg-slate-50 flex flex-col items-center justify-center min-h-[400px] order-1 md:order-2">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-8">Live Preview</div>
            <TodoList />
          </div>
        </div>
      </section>
    </div>
  );
}
