export default function NestedFragments() {
  let show = $state(true)
  return (
    <div>
      {show && (
        <>
          <span>A</span>
          <>
            <span>B</span>
            <span>C</span>
          </>
        </>
      )}
    </div>
  )
}
