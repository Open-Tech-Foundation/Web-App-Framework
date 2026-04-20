import Clock from './components/Clock.jsx';

function useTime() {
  const time = $state(new Date());
  
  onMount(() => {
    const id = setInterval(() => {
      time.value = new Date();
    }, 1000);
    onCleanup(() => clearInterval(id));
  });
  
  return time;
}

export default function Page() {
  const time = useTime();
  const color = $state('lightcoral');

  return (
    <div>
      <p>
        Pick a color:{' '}
        <select value={color.value} onchange={e => color.value = e.target.value}>
          <option value="lightcoral">lightcoral</option>
          <option value="midnightblue">midnightblue</option>
          <option value="rebeccapurple">rebeccapurple</option>
        </select>
      </p>
      <Clock color={color.value} time={time.value.toLocaleTimeString()} />
    </div>
  );
}
