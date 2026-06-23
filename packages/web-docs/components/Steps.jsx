// Numbered, vertically-connected steps for walkthroughs. Each child heading
// (`<h3>`/`<h4>`) becomes a numbered step via a CSS counter, so it composes with
// plain Markdown inside MDX:
//
//   <Steps>
//   ### Install
//   …
//   ### Run the dev server
//   …
//   </Steps>

export default function Steps(props) {
  return <div class="otfw-steps">{props.children}</div>;
}
