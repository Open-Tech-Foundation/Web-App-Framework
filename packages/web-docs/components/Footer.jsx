// Site footer, driven by `config.footer` ({ text, links }).

export default function Footer(props) {
  const config = props.config || {};
  const footer = config.footer || {};
  const text = footer.text || "Built with OTF Web";
  const links = footer.links || [];

  return (
    <footer class="otfw-footer">
      <div class="otfw-footer-inner">
        <div class="otfw-footer-text">{text}</div>
        {links.length > 0 ? (
          <div class="otfw-footer-links">
            {links.map((l) => (
              <a href={l.href} class="otfw-footer-link">
                {l.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </footer>
  );
}
