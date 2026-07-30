// The markup the parser does *not* leave alone. Every subtree here must come out of
// `template_html` as `None`, so both builds emit the same per-node code — and the DOM
// must match. If the analysis ever relaxes wrongly, this fixture is where the two
// builds diverge first.
export default function Edge() {
  return (
    <div class="edge">
      {/* `</p>` is implied before a block element, hoisting it out of the paragraph. */}
      <p class="wrapper">
        <div id="hoisted">block inside a paragraph</div>
      </p>

      {/* A nested `<a>` closes the outer one; same for button, li and dd. */}
      <a href="/outer">
        outer
        <a href="/inner">inner</a>
      </a>
      <button type="button">
        outer
        <button type="button">inner</button>
      </button>
      <ul>
        <li>
          outer
          <li>sibling by implication</li>
        </li>
      </ul>

      {/* A heading directly inside a heading pops the outer one. */}
      <h1 class="outer">
        <h2 class="inner">nested heading</h2>
      </h1>

      {/* A bare `<tr>` under `<table>` gains a `<tbody>`; a `<div>` is foster-parented. */}
      <table class="bare">
        <tr>
          <td>no tbody in the source</td>
        </tr>
      </table>

      {/* Raw-text and form-state elements the serializer must never write. */}
      <style>{".x { color: red }"}</style>
      <textarea rows="2">a &lt; b</textarea>
      <form action="/submit">
        <select name="pick">
          <option value="1">one</option>
          <option value="2">two</option>
        </select>
      </form>

      {/* SVG: the parser has its own attribute-case table, `setAttribute` does not. */}
      <svg viewBox="0 0 16 16" width="16" height="16">
        <circle cx="8" cy="8" r="4" />
        <foreignObject width="8" height="8">
          <div class="in-foreign">html again</div>
        </foreignObject>
      </svg>

      {/* Escaping corners: quotes, ampersands and angle brackets in both positions. */}
      <p title={'a "quoted" & <angled> value'}>text with &lt;tags&gt; &amp; entities</p>
      <div data-json='{"a":1}' class="a b   c">whitespace &amp; attributes</div>
    </div>
  );
}
