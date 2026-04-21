export default function MultipleComponents(props) {
  return (
    <div>
      <A val={props.a} />
      <B val={props.b} />
    </div>
  );
}

function A(props) {
  return <div>{props.val}</div>;
}

function B(props) {
  return <div>{props.val}</div>;
}
