export default function DndDemoPage() {
  const columns = [
    { id: "todo", title: "To Do", accent: "text-slate-300" },
    { id: "doing", title: "In Progress", accent: "text-amber-300" },
    { id: "done", title: "Done", accent: "text-emerald-300" },
  ];

  let tasks = $state([
    { id: 1, text: "Wire up native drag events", status: "todo" },
    { id: 2, text: "Reorder with keyed lists", status: "todo" },
    { id: 3, text: "Compile JSX with otfwc", status: "doing" },
    { id: 4, text: "Reactive signals", status: "done" },
    { id: 5, text: "Drop targets highlight", status: "todo" },
  ]);

  let dragId = $state(null);
  let overColumn = $state(null);

  const onDragStart = (id) => (e) => {
    dragId = id;
    e.dataTransfer.effectAllowed = "move";
    // Some browsers require data to be set for the drag to begin.
    e.dataTransfer.setData("text/plain", String(id));
  };

  const onDragEnd = () => {
    dragId = null;
    overColumn = null;
  };

  const onDragOver = (status) => (e) => {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = "move";
    if (overColumn !== status) overColumn = status;
  };

  const onDrop = (status) => (e) => {
    e.preventDefault();
    if (dragId == null) return;
    tasks = tasks.map((t) => (t.id === dragId ? { ...t, status } : t));
    dragId = null;
    overColumn = null;
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Drag &amp; Drop</h1>
        <p className="text-slate-400 max-w-2xl">
          A Kanban board driven entirely by native HTML5 drag events
          (<code>ondragstart</code>, <code>ondragover</code>, <code>ondrop</code>,
          <code> ondragend</code>) wired through the framework. Dropping a card
          mutates a <code>$state</code> array and the keyed list re-renders.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columns.map((col) => (
          <div
            key={col.id}
            ondragover={onDragOver(col.id)}
            ondragleave={() => { if (overColumn === col.id) overColumn = null; }}
            ondrop={onDrop(col.id)}
            className={
              "rounded-2xl border p-4 min-h-[260px] transition-colors " +
              (overColumn === col.id
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-slate-700 bg-slate-900/40")
            }
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className={"text-sm font-bold uppercase tracking-wide " + col.accent}>
                {col.title}
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {tasks.filter((t) => t.status === col.id).length}
              </span>
            </div>

            <div className="space-y-2">
              {tasks
                .filter((t) => t.status === col.id)
                .map((t) => (
                  <div
                    key={t.id}
                    draggable={true}
                    ondragstart={onDragStart(t.id)}
                    ondragend={onDragEnd}
                    className={
                      "cursor-grab active:cursor-grabbing select-none rounded-lg border border-slate-600/60 bg-slate-800 p-3 text-sm text-slate-200 shadow transition-opacity " +
                      (dragId === t.id ? "opacity-40" : "hover:border-slate-500")
                    }
                  >
                    {t.text}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Tip: grab a card and drop it into another column.
      </p>
    </div>
  );
}
