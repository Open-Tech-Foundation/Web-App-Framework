# @opentf/web-form

A high-performance, **path-based reactive forms engine** for [OTF Web](https://github.com/Open-Tech-Foundation/Web-App-Framework).

Fields bind directly to a `reactive()` store, so updates are surgical — typing in
one field only re-runs the effects that read that field. No virtual DOM, no
re-render, no memoization.

## Features

- 🌿 **Reactive values** — read `form.values.user.name` / `form.errors.email`
  straight in your JSX; they update fine-grained.
- 🌲 **Nested state & arrays** — address any depth by dot-path (`"user.profile.firstName"`, `"tags.0"`).
- 🛡️ **Validation** — a plain function or a schema library (Zod, Valibot, …), with `onChange` / `onBlur` / `onSubmit` modes.
- 🚀 **Fine-grained** — per-keystroke work is `O(path)`, not `O(fields)`.
- 🛠️ **`register` pattern** — spread one call onto an input to wire it up.

## Installation

```bash
npm install @opentf/web-form
# or
bun add @opentf/web-form
```

## Basic usage

`createForm` returns a stable form object. Spread `register(path)` onto an input
to bind it, and wrap your submit handler with `handleSubmit`.

```jsx
import { createForm } from "@opentf/web-form";

export function SignupForm() {
  const form = createForm({
    initialValues: { username: "", email: "" },
    validate: (values) => {
      const errors = {};
      if (!values.username) errors.username = "Username required";
      if (!values.email.includes("@")) errors.email = "Invalid email";
      return errors;
    },
  });

  const onSubmit = (values) => console.log("Submitted:", values);

  return (
    <form onsubmit={form.handleSubmit(onSubmit)}>
      <label for="username">Username</label>
      <input {...form.register("username")} id="username" />
      {form.errors.username && <span class="error">{form.errors.username}</span>}

      <label for="email">Email</label>
      <input {...form.register("email")} id="email" />
      {form.errors.email && <span class="error">{form.errors.email}</span>}

      <button type="submit">Sign up</button>
    </form>
  );
}
```

`register(path)` returns everything a field needs — `name`, `value`, `checked`
(for checkboxes/radios), `error`, `isTouched`, `oninput`, and `onblur` — so a
controlled input is one line.

## Reactive values

`form.values`, `form.errors`, `form.touched`, and `form.changed` are reactive
stores — read them directly in your template and only the nodes that read a
changed path update. There is no provider to thread through.

```jsx
<p>Hello, {form.values.username || "stranger"}</p>
```

## Nested state & arrays

Address objects and arrays by dot-path; arrays use the index as a segment.

```jsx
const form = createForm({
  initialValues: {
    user: {
      profile: { firstName: "John" },
      settings: { notifications: true },
    },
  },
});

<input {...form.register("user.profile.firstName")} />
<input {...form.register("user.settings.notifications")} type="checkbox" />
```

Read nested values and errors with ordinary property access:

```jsx
<p>{form.values.user.profile.firstName}</p>
{form.errors.user?.firstName && <span class="error">{form.errors.user.firstName}</span>}
```

### Dynamic arrays

The values store is a real reactive object — mutate it directly:

```jsx
const form = createForm({ initialValues: { skills: ["JavaScript"] } });

// Add / remove
const addSkill = () => form.values.skills.push("");
const removeSkill = (i) => form.values.skills.splice(i, 1);

// Render a row per item; editing one input never re-renders the others
{form.values.skills.map((skill, i) => (
  <input {...form.register(`skills.${i}`)} />
))}
```

## Validation

A validator receives the current `values` and returns an errors object keyed by
field path. Use `validate` to return the errors object directly, or `validator`
to return `{ errors }` (handy for schema resolvers).

```jsx
const form = createForm({
  mode: "onChange",
  initialValues: { age: 0 },
  validate: (values) => {
    const errors = {};
    if (values.age < 18) errors.age = "Too young";
    return errors;
  },
});
```

### Schema validation (Zod)

Wrap a schema in a resolver that maps issues to the path-keyed shape. The
resolver closes over the schema and takes the form `values`:

```jsx
import { z } from "zod";

const schema = z.object({
  username: z.string().min(3, "Too short"),
  email: z.string().email("Invalid email"),
});

const zodResolver = (schema) => (values) => {
  const result = schema.safeParse(values);
  if (result.success) return { errors: {} };
  const errors = {};
  for (const issue of result.error.issues) {
    errors[issue.path.join(".")] = issue.message;
  }
  return { errors };
};

const form = createForm({
  initialValues: { username: "", email: "" },
  validator: zodResolver(schema),
});
```

A validator may be **async** (return a Promise); `form.isValidating` is `true`
while it resolves — useful for server-side uniqueness checks.

### Validation modes

| Option | Values | Default | When it validates |
| :--- | :--- | :--- | :--- |
| `mode` | `"onChange"` `"onBlur"` `"onSubmit"` | `"onBlur"` | `onChange`: every edit + on mount · `onBlur`: on blur · `onSubmit`: only on submit |
| `reValidateMode` | `"onChange"` `"onBlur"` | `"onChange"` | After the first error exists, when to re-validate |

```js
createForm({ mode: "onChange", reValidateMode: "onBlur" });
```

`handleSubmit` always runs the validator first and only calls your handler when
the form is valid, so a final check is guaranteed regardless of `mode`.

## Status flags

`createForm` exposes derived flags — read them directly (they are reactive in JSX):

| Flag | Description |
| :--- | :--- |
| `isValid` | `true` when there are no errors. |
| `isChanged` | `true` when values differ from `initialValues`. |
| `isTouched` | `true` when any field has been blurred. |
| `isSubmitting` | `true` while an async `onSubmit` handler is running. |
| `isValidating` | `true` while an async validator is running. |
| `isSubmitted` | `true` after a successful submit. |
| `submitCount` | Number of submit attempts. |

```jsx
<button type="submit" disabled={form.isSubmitting || !form.isValid}>
  {form.isSubmitting ? "Saving…" : "Save"}
</button>
```

Per-field `touched` and `changed` state is on the matching store:
`form.touched.email`, `form.changed.user`.

## Resetting

`reset()` restores `initialValues` and clears status. Pass an object to reset to
new baseline values (which become the new "initial" for `isChanged`).

```jsx
<button type="button" onclick={() => form.reset()}>Reset</button>
```

```js
form.reset();                 // back to initial
form.reset({ username: "" }); // new baseline
```

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
