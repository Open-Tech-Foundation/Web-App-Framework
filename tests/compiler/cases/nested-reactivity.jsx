export default function NestedReactivity(props) {
  const show = $state(true);
  return (
    <div>
      {show.value && <span title={props.title}>Hello</span>}
    </div>
  );
}
