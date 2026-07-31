// Raw text: the tokenizer does not parse markup inside these elements, so hydration
// markers written in there would be served as literal characters — visible in the
// textarea and in the stylesheet.
export default function RcData() {
  let note = $state("first line\nsecond line");
  let css = $state(".swatch > b { color: red }");
  return (
    <div class="root">
      <textarea class="ta">{note}</textarea>
      <style>{css}</style>
      <p class="swatch">
        <b>styled</b>
      </p>
    </div>
  );
}
