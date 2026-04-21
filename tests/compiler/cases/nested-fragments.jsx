export default function NestedFragments(props) {
  const show = $state(true);
  return (
    <div>
      {show.value && (
        <>
          <span title={props.t1}>Part 1</span>
          <span title={props.t2}>Part 2</span>
        </>
      )}
    </div>
  );
}
