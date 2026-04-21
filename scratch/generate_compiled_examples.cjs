const babel = require("@babel/core");
const pluginPath = "/home/G/projects/lab/waf/framework/compiler/babel-plugin.cjs";

const counterCode = `export default function Counter() {
  let count = $state(0);

  return (
    <div className="flex gap-4 items-center">
      <button onclick={() => count--} className="btn">-</button>
      <span className="text-2xl font-bold w-12 text-center">{count}</span>
      <button onclick={() => count++} className="btn">+</button>
    </div>
  );
}`;

const todoCode = `export default function TodoList() {
  let todos = $state([{ id: 1, text: "Learn WAF", done: false }]);
  
  const toggle = (id) => {
    todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
  };
  
  return (
    <ul className="space-y-2">
      {todos.map(todo => (
        <li key={todo.id} className="flex gap-2">
          <input 
            type="checkbox" 
            checked={todo.done} 
            onchange={() => toggle(todo.id)} 
          />
          <span className={todo.done ? "line-through" : ""}>
            {todo.text}
          </span>
        </li>
      ))}
    </ul>
  );
}`;

function compile(code, name) {
  const result = babel.transformSync(code, {
    plugins: ["@babel/plugin-syntax-jsx", [pluginPath]],
    filename: name + ".jsx"
  });
  return result.code;
}

console.log("--- COUNTER ---");
console.log(compile(counterCode, "Counter"));
console.log("\n--- TODO ---");
console.log(compile(todoCode, "TodoList"));
