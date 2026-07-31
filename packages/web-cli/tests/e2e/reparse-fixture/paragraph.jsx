// The classic reshape: the parser closes the `<p>` before the `<div>` and hoists the
// div out, so the server bytes do not come back as the tree they were written as.
// Nothing here may be adopted — the route has to build on the client instead.
export default function Paragraph() {
  let n = $state(0);
  return (
    <div class="root">
      <p class="para">
        count {n}
        <div class="inner">block</div>
      </p>
    </div>
  );
}
