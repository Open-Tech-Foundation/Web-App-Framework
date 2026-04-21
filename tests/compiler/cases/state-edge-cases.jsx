export default function StateEdgeCases() {
  let count = $state(0);
  let user = $state({ name: "Alice", age: 30 });
  let todos = $state([]);

  // 1. Basic reassignment
  count = 10;
  
  // 2. Update expressions
  count++;
  --count;

  // 3. Member expressions
  user.name = "Bob";
  const age = user.age;
  todos.push("learn waf");

  // 4. Object property shorthand
  const data = { count, user };

  // 5. Destructuring
  const { name } = user;
  const [first] = todos;

  // 6. Computed property access
  const prop = "age";
  console.log(user[prop]);

  // 7. Passing as argument
  console.log(count, user);

  return (
    <div>
      <span>{count}</span>
      <span>{user.name}</span>
      <button onclick={() => {
        count++;
        user.age++;
      }}>Increment</button>
    </div>
  );
}
