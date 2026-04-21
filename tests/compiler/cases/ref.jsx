function CustomInput() {
  const input = $ref();
  const focus = () => input.focus();
  
  $expose({ focus });
  
  return (
    <input ref={input} type="text" placeholder="Custom Input" />
  );
}

export default function RefTest() {
  const myDiv = $ref();
  const myInput = $ref();
  let color = $state("red");

  onMount(() => {
    myDiv.style.backgroundColor = "lightgray";
    myInput.focus();
  });

  return (
    <div ref={myDiv} style={{ padding: "20px" }}>
      <h1 style={{ color }}>Ref Test</h1>
      <CustomInput ref={myInput} />
      <button onclick={() => color = "blue"}>Change Color</button>
    </div>
  );
}
