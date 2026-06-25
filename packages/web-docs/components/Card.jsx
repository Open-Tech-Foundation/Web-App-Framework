// A single tile in a <Cards> grid: a title, an optional description, and a link. An
// internal `href` uses SPA navigation (<Link>); an `external` href is a plain anchor.
// `desc` (prop) or children supply the body.

import { Link } from "@opentf/web";

export default function Card(props) {
  return props.external ? (
    <a href={props.href} target="_blank" rel="noreferrer" class="otfw-card">
      <span class="otfw-card-title">{props.title}</span>
      {props.desc ? <span class="otfw-card-desc">{props.desc}</span> : null}
      {props.children}
    </a>
  ) : (
    <Link href={props.href} class="otfw-card">
      <span class="otfw-card-title">{props.title}</span>
      {props.desc ? <span class="otfw-card-desc">{props.desc}</span> : null}
      {props.children}
    </Link>
  );
}
