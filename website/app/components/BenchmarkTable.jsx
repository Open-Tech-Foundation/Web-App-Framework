// Renders the generated benchmark report (app/benchmark-report.json, written by
// `bun run bench all`) as the homepage comparison table. Pure presentation — the
// medians and the per-row winner (`best`, timing-resolution rule included) come
// from the runner, so the table can't drift from the last recorded run.

const HEAD_CLS = "px-4 py-3 text-xs font-bold uppercase tracking-widest text-right";
const CELL_CLS = "px-4 py-3 text-right font-mono";

// "243.35 → 243.4", "278.7 → 278.7", missing → em dash.
function formatMs(value) {
  return typeof value === "number" ? value.toFixed(1).replace(/\.0$/, "") : "—";
}

export default function BenchmarkTable(props) {
  const report = props.report;
  const lead = report.highlightEngine ?? report.engines[0];

  // Every cell's text + classes are precomputed here so the JSX `.map` bodies
  // below stay single expressions (no locals inside markup). Same styling rules
  // as the previous hand-rolled table: the lead engine's column reads in the main
  // text color (accent when it wins); other engines are muted unless they win.
  const columns = report.engines.map((engine) => ({
    engine,
    cls: `${HEAD_CLS} ${engine === lead ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`,
  }));
  const rows = report.rows.map((row) => ({
    label: row.label,
    cells: report.engines.map((engine) => ({
      engine,
      text: formatMs(row.values[engine]),
      cls:
        `${CELL_CLS} ` +
        (row.best === engine
          ? engine === lead
            ? "font-bold text-[var(--accent)]"
            : "font-bold text-[var(--text-main)]"
          : engine === lead
            ? "text-[var(--text-main)]"
            : "text-[var(--text-muted)]"),
    })),
  }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-sm">
        <thead>
          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border)]">
            <th className="px-6 py-3 text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Operation</th>
            {columns.map((col) => (
              <th key={col.engine} className={col.cls}>{col.engine}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="px-6 py-3 font-medium text-[var(--text-main)]">{row.label}</td>
              {row.cells.map((cell) => (
                <td key={cell.engine} className={cell.cls}>{cell.text}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
