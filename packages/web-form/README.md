# @opentf/web-form

A reactive form management library for the **Web App Framework**.

## Features

- ✅ **Reactive Binding**: Seamlessly bind form values to signals.
- 🌲 **Nested State**: Support for complex, nested form structures.
- 🛡️ **Validation**: Flexible validation system with Zod or custom logic.
- 🚀 **High Performance**: Direct DOM updates without VDOM overhead.
- 🛠️ **Simple API**: Featuring a `register` pattern for clean boilerplate-free code.

## Installation

```bash
npm install @opentf/web-form
```

## Basic Usage

### Using the `register` Pattern

The `register` function returns all necessary props (`name`, `value`, `oninput`, `onblur`) to bind a field to an input element.

```jsx
import { createForm } from '@opentf/web-form';

const form = createForm({
  initialValues: { username: '' }
});

// In your component
<input {...form.register('username')} />
```

## Validation with Zod

You can easily integrate **Zod** for schema-based validation by providing a `validator` function.

```javascript
import { createForm } from '@opentf/web-form';
import { z } from 'zod';

const schema = z.object({
  username: z.string().min(3, 'Too short'),
  email: z.string().email('Invalid email')
});

// A simple Zod validator wrapper
const zodValidator = (values, schema) => {
  const result = schema.safeParse(values);
  if (result.success) return {};
  const errors = {};
  result.error.errors.forEach(e => {
    errors[e.path.join('.')] = e.message;
  });
  return { errors };
};

const form = createForm({
  initialValues: { username: '', email: '' },
  schema,
  validator: zodValidator // Can return { errors: ... } or direct errors object
});

const onSubmit = (values) => {
  console.log('Form Submitted:', values);
};

// In your component
<form onsubmit={form.handleSubmit(onSubmit)}>
  <div>
    <input {...form.register('username')} placeholder="Username" />
    <span className="error">{form.errors.username}</span>
  </div>
  
  <div>
    <input {...form.register('email')} placeholder="Email" />
    <span className="error">{form.errors.email}</span>
  </div>

  <button type="submit">Submit</button>
</form>
```

## Form State Helpers

`createForm` returns several reactive signals and proxies to track the form lifecycle:

| Helper | Type | Description |
| :--- | :--- | :--- |
| `isValid` | `Signal<boolean>` | `true` if there are no validation errors. |
| `isChanged` | `Signal<boolean>` | `true` if the form values differ from `initialValues`. |
| `isTouched` | `Signal<boolean>` | `true` if any field has been blurred. |
| `isSubmitting` | `Signal<boolean>` | `true` while the `onSubmit` handler is running. |
| `isSubmitted` | `Signal<boolean>` | `true` if the form has been successfully submitted. |
| `touched` | `Proxy<boolean>` | Access per-field touched state: `form.touched.email`. |
| `changed` | `Proxy<boolean>` | Access per-field changed state: `form.changed.email`. |

## Validation Modes

You can customize when validation triggers using `mode` and `reValidateMode`.

```javascript
const form = createForm({
  mode: 'onBlur',          // Initial validation: 'onSubmit', 'onBlur', 'onTouched', 'onChange'
  reValidateMode: 'onChange' // Re-validation: 'onChange', 'onBlur', 'onSubmit'
});
```

- **Default mode**: `onBlur`
- **Default reValidateMode**: `onChange`

### Resetting the Form

You can restore the form to its `initialValues` and clear all status flags using the `reset()` method.

```javascript
<button type="button" onclick={() => form.reset()}>
  Reset Form
</button>
```

## Custom Validation

For simpler cases, you can use the `validate` function which expects you to return the errors object directly.

```javascript
const form = createForm({
  initialValues: { age: 0 },
  validate: (values) => {
    const errors = {};
    if (values.age < 18) errors.age = 'Too young';
    return errors;
  }
});
```

## License

MIT © [Open Tech Foundation](https://github.com/Open-Tech-Foundation)
