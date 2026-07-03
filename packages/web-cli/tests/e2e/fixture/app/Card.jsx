export default function Card({ children }) {
  let taps = $state(0);
  return (
    <div class="card">
      <button class="card-toggle" onclick={() => taps++}>card {taps}</button>
      {children}
    </div>
  );
}
