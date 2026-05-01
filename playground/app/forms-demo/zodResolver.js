import { set } from "@opentf/std";

/**
 * A Zod resolver for web-forms.
 * Converts Zod validation errors into a nested object matching the form structure.
 * This is a demo-specific utility and is not part of the core Web App Framework library.
 */
export function zodResolver(schema) {
  return (values) => {
    const result = schema.safeParse(values);
    
    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors = {};
    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.');
      set(errors, path, issue.message);
    });

    return { values: {}, errors };
  };
}
