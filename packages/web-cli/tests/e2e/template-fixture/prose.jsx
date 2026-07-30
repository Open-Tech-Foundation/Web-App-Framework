// Docs-page prose: the shapes an MDX page compiles to, which is where template
// cloning pays off most. Every subtree here is static, so most of it should be
// stamped rather than built — and must render identically either way.
export default function Prose() {
  return (
    <article class="doc">
      <h1 id="title">Static generation</h1>
      <p>
        A paragraph with <code>inline code</code>, <em>emphasis</em>, <strong>strong</strong>,
        and <a href="/docs/routing">a link</a> — plus an entity-ish run: 1 &lt; 2 &amp; 3 &gt; 0.
      </p>
      <p>
        Text with a <br /> line break, an <img src="/logo.png" alt="A &quot;logo&quot;" width="16" />
        inline image, and a <a href="/x?a=1&b=2">query link</a>.
      </p>
      <blockquote>
        <p>Quoted prose, which is a paragraph inside a block container.</p>
      </blockquote>
      <h2 id="lists">Lists</h2>
      <ul class="bullets">
        <li>flat item one</li>
        <li>
          an item with a nested list
          <ul>
            <li>nested one</li>
            <li>nested two</li>
          </ul>
        </li>
      </ul>
      <ol start="3">
        <li>ordered</li>
        <li>ordered too</li>
      </ol>
      <dl>
        <dt>term</dt>
        <dd>definition</dd>
        <dt>another</dt>
        <dd>another definition</dd>
      </dl>
      <hr />
      <pre class="code">
        <code class="language-js">const x = 1;{"\n"}console.log(x);</code>
      </pre>
      <figure>
        <img src="/diagram.svg" alt="" />
        <figcaption>A caption below the figure.</figcaption>
      </figure>
      <details>
        <summary>Show more</summary>
        <p>Hidden detail text.</p>
      </details>
    </article>
  );
}
