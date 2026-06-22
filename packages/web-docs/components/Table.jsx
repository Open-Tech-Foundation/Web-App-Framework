// Styled, horizontally-scrollable table wrapper. (MDX GFM tables already emit a
// bare <table>, styled by the theme; use <Table> in JSX pages or to force the
// responsive scroll container.)

export default function Table(props) {
  return (
    <div class="otfw-table-wrap">
      <table class="otfw-table">{props.children}</table>
    </div>
  );
}
