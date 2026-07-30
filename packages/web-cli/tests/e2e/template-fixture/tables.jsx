// Tables are where the HTML parser rewrites structure most aggressively: a bare
// `<tr>` under `<table>` grows an implied `<tbody>`, and anything that is not table
// content is foster-parented out in front of the table. The canonical shapes here
// are the ones the analysis admits; `edge.jsx` carries the ones it must refuse.
export default function Tables() {
  return (
    <div class="tables">
      <table class="gfm">
        <thead>
          <tr>
            <th align="left">Option</th>
            <th align="right">Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ssg</code>
            </td>
            <td align="right">false</td>
          </tr>
          <tr>
            <td>base</td>
            <td align="right">/</td>
          </tr>
        </tbody>
      </table>

      <table>
        <caption>With a caption and a column group</caption>
        <colgroup>
          <col span="2" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <td>a</td>
            <td>b</td>
            <td>c</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">footer row</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
