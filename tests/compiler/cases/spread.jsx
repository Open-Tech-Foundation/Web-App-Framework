export default function SpreadTest() {
  const props = {
    id: "test",
    className: "foo",
    "data-custom": "bar"
  };

  return (
    <div {...props}>
      <span {...{ style: { color: "red" } }}>Hello</span>
    </div>
  );
}
