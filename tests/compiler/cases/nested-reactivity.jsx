export default function NestedReactivity(props) {
  let show = $state(true);
  return (
    <div>
      {show && <span title={props.title}>Hello</span>}
    </div>
  );
}
