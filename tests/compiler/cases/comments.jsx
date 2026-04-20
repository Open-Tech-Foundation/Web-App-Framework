export default function CommentsTest() {
  return (
    <div>
      {/* This is a top-level comment */}
      <h1>Title</h1>
      <p 
        /* This is an attribute comment */
        class="foo"
      >
        Content
        {/* This is a nested comment */}
        { // This is an inline double-slash comment 
        }
      </p>
    </div>
  )
}
