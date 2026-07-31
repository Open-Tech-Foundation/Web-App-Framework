// Styled, horizontally-scrollable table wrapper. (MDX GFM tables already emit
// the same wrapper around a theme-styled <table>; use <Table> in JSX pages.)

export default function Table(props) {
  return (
    <div class="otfw-table-wrap" tabindex="0">
      <table class="otfw-table">{props.children}</table>
    </div>
  );
}
