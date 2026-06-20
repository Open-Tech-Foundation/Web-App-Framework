export function CompilerCore({ staticProp, dynamicProp }) {
  let count = $state(0);
  let show = $state(true);
  let list = $state(["A", "B", "C"]);

  return (
    <div id="compiler-root" class="test-root" style={{ padding: "10px", color: "blue" }}>
      <h1 data-testid="title">Compiler Core Test</h1>
      
      <section data-testid="props-test">
        <p>Static: {staticProp}</p>
        <p>Dynamic: {dynamicProp}</p>
      </section>

      <section data-testid="reactivity-test">
        <button onclick={() => count++} data-testid="inc-btn">
          Count is: {count}
        </button>
      </section>

      <section data-testid="conditional-test">
        <button onclick={() => show = !show} data-testid="toggle-btn">
          Toggle
        </button>
        {show && <div data-testid="visible-div">I am visible</div>}
      </section>

      <section data-testid="list-test">
        <ul>
          {list.map((item, index) => (
            <li data-testid={`item-${index}`}>{item} (at {index})</li>
          ))}
        </ul>
      </section>

      <section data-testid="spread-test">
        <div {...{ id: "spread-id", "data-attr": "spread-val" }}>Spread content</div>
      </section>

      <section data-testid="fragment-test">
        <>
          <span>Frag 1</span>
          <span>Frag 2</span>
        </>
      </section>
    </div>
  );
}
