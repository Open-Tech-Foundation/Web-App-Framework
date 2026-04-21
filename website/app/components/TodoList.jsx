export default function TodoList() {
  let todos = $state([
    { id: 1, text: "Learn WAF", done: true },
    { id: 2, text: "Build an App", done: false }
  ]);

  const toggleTodo = (id) => {
    todos = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
  };

  const addTodo = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      todos = [...todos, { id: Date.now(), text: e.target.value.trim(), done: false }];
      e.target.value = '';
    }
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 w-full max-w-sm">
      <input 
        type="text" 
        placeholder="What needs to be done?" 
        onkeyup={addTodo}
        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 mb-4 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
      <ul className="space-y-2">
        {todos.map(todo => (
          <li key={todo.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors">
            <input 
              type="checkbox" 
              checked={todo.done} 
              onchange={() => toggleTodo(todo.id)} 
              className="w-5 h-5 accent-[#ff851b] rounded cursor-pointer"
            />
            <span className={todo.done ? "line-through text-slate-400" : "text-slate-700 font-medium"}>
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
