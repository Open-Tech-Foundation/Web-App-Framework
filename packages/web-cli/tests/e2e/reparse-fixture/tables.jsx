// Bare rows under <table> gain an implied <tbody> when the parser reads the server
// HTML back; lowering inserts it so all three backends agree on the tree.
export default function Tables() {
  let n = $state(1);
  const rows = ["alpha", "beta"];
  return (
    <div class="root">
      <table class="bare">
        <tr>
          <td class="cell">{n}</td>
        </tr>
        <tr>
          <td>static</td>
        </tr>
      </table>
      <table class="listed">
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td>{row}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
