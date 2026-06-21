export default function TodoList() {
  let todos = $state([
    { id: 1, text: "Learn OTF Web", done: true },
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
    <div className="bg-[var(--bg-main)] p-5 rounded-2xl shadow-sm border border-[var(--border)] w-full max-w-sm">
      <input 
        type="text" 
        placeholder="What needs to be done?" 
        onkeyup={addTodo}
        className="w-full px-4 py-2.5 rounded-xl border border-[var(--border)] mb-4 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
      <ul className="space-y-2">
        {todos.map(todo => (
          <li key={todo.id} className="flex items-center gap-3 p-2 hover:bg-[var(--bg-surface)] rounded-lg transition-colors">
            <input 
              type="checkbox" 
              checked={todo.done} 
              onchange={() => toggleTodo(todo.id)} 
              className="w-5 h-5 accent-[#ff851b] rounded cursor-pointer"
            />
            <span className={todo.done ? "line-through text-[var(--text-muted)]" : "text-[var(--text-main)] font-medium"}>
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
