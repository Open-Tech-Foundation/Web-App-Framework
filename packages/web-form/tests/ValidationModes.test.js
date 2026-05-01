import { expect, test, describe } from "bun:test";
import { createForm } from "../index.js";

describe("Web App Framework Forms Library - Validation Modes", () => {
  test("mode: onBlur (default)", () => {
    const form = createForm({
      initialValues: { name: "" },
      validate: (v) => v.name.length < 3 ? { name: "Short" } : {}
    });
    
    expect(form.errors.name).toBeUndefined();
    
    // oninput should NOT trigger validation
    form.register("name").oninput({ target: { value: "a" } });
    expect(form.errors.name).toBeUndefined();
    
    // onblur SHOULD trigger validation
    form.register("name").onblur();
    expect(form.errors.name).toBe("Short");
  });

  test("mode: onChange", () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { name: "" },
      validate: (v) => v.name.length < 3 ? { name: "Short" } : {}
    });
    
    expect(form.errors.name).toBe("Short"); // Validates on init
    
    form.register("name").oninput({ target: { value: "abc" } });
    expect(form.errors.name).toBeUndefined();
  });

  test("mode: onSubmit", async () => {
    const form = createForm({
      mode: "onSubmit",
      initialValues: { name: "" },
      validate: (v) => v.name.length < 3 ? { name: "Short" } : {}
    });
    
    form.register("name").oninput({ target: { value: "a" } });
    form.register("name").onblur();
    expect(form.errors.name).toBeUndefined();
    
    await form.handleSubmit(() => {})();
    expect(form.errors.name).toBe("Short");
  });

  test("reValidateMode: onChange (default)", () => {
    const form = createForm({
      mode: "onBlur", // Validate on blur first
      initialValues: { name: "" },
      validate: (v) => v.name.length < 3 ? { name: "Short" } : {}
    });
    
    form.register("name").onblur();
    expect(form.errors.name).toBe("Short");
    
    // Once error exists, oninput SHOULD trigger re-validation
    form.register("name").oninput({ target: { value: "abc" } });
    expect(form.errors.name).toBeUndefined();
  });

  test("reValidateMode: onBlur", () => {
    const form = createForm({
      mode: "onBlur",
      reValidateMode: "onBlur",
      initialValues: { name: "" },
      validate: (v) => v.name.length < 3 ? { name: "Short" } : {}
    });
    
    form.register("name").onblur();
    expect(form.errors.name).toBe("Short");
    
    // Should NOT re-validate on input
    form.register("name").oninput({ target: { value: "abc" } });
    expect(form.errors.name).toBe("Short");
    
    // Should re-validate on blur
    form.register("name").onblur();
    expect(form.errors.name).toBeUndefined();
  });
});
