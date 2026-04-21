export default function ComplexExpressions(props) {
  const count = $state(0);
  return (
    <div 
      className={props.theme}
      style={{ color: props.color, opacity: count.value > 5 ? 1 : 0.5 }}
    >
      {props.loading ? (
        <span>Loading...</span>
      ) : (
        <div>
          <h1>{props.title}</h1>
          <button onclick={() => console.log(props.logMessage)}>
            Log {count.value}
          </button>
        </div>
      )}
    </div>
  );
}
