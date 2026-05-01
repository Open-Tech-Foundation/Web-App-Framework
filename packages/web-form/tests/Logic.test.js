import { expect, test, describe } from "bun:test";
import { createForm } from "../index.js";

describe("Web App Framework Forms Library - Pure Logic", () => {
  test("initializes with flat values", () => {
    const form = createForm({
      initialValues: { username: "alice", email: "alice@example.com" }
    });
    
    expect(form.values.username).toBe("alice");
    expect(form.values.email).toBe("alice@example.com");
  });

  test("initializes with nested values", () => {
    const form = createForm({
      initialValues: {
        profile: { firstName: "John", lastName: "Doe" }
      }
    });
    
    expect(form.values.profile.firstName).toBe("John");
    expect(form.values.profile.lastName).toBe("Doe");
  });

  test("initializes with array values", () => {
    const form = createForm({
      initialValues: {
        skills: ["JS", "Framework"]
      }
    });
    
    expect(form.values.skills[0]).toBe("JS");
    expect(form.values.skills[1]).toBe("Framework");
  });

  test("updates values reactively", () => {
    const form = createForm({
      initialValues: { count: 0 }
    });
    
    form.values.count = 1;
    expect(form.values.count).toBe(1);
  });

  test("supports direct assignment to values proxy", () => {
    const form = createForm({
      initialValues: { user: { name: "A" } }
    });
    
    form.values.user = { name: "B" };
    expect(form.values.user.name).toBe("B");
  });

  test("validates values", () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { age: 20 },
      validate: (v) => {
        const errors = {};
        if (v.age < 18) errors.age = "Too young";
        return errors;
      }
    });
    
    expect(form.errors.age).toBeUndefined();
    form.values.age = 10;
    expect(form.errors.age).toBe("Too young");
  });

  test("errors proxy supports direct access", () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { username: "" },
      validate: (v) => (v.username ? {} : { username: "Required" }),
    });

    expect(form.errors.username).toBe("Required");

    form.values.username = "Alice";
    expect(form.errors.username).toBeUndefined();
  });


  test("supports Zod-style validator returning { errors }", () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { email: "a" },
      validator: (v) => {
        return { errors: { email: "Invalid email" } };
      },
    });

    expect(form.errors.email).toBe("Invalid email");
  });

  test("handles async validation", async () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { username: "abc" },
      validate: async (v) => {
        await new Promise((r) => setTimeout(r, 10));
        return v.username.length < 3 ? { username: "Too short" } : {};
      },
    });

    expect(form.isValidating).toBe(true); // Immediate validation in onChange mode
    await new Promise((r) => setTimeout(r, 20));
    expect(form.isValidating).toBe(false);
    expect(form.errors.username).toBeUndefined();

    form.values.username = "al";
    expect(form.isValidating).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(form.isValidating).toBe(false);
    expect(form.errors.username).toBe("Too short");

    form.values.username = "alice";
    await new Promise((r) => setTimeout(r, 20));
    expect(form.errors.username).toBeUndefined();
    expect(form.isValid).toBe(true);
  });

  test("reactive array mutations (push/splice)", () => {
    const form = createForm({
      initialValues: { tags: ["js"] },
    });

    let changeCount = 0;
    form._signals.values.subscribe(() => changeCount++);
    expect(changeCount).toBe(1);

    form.values.tags.push("web");
    expect(form.values.tags).toEqual(["js", "web"]);
    expect(changeCount).toBe(2);

    form.values.tags.splice(0, 1);
    expect(form.values.tags).toEqual(["web"]);
    expect(changeCount).toBe(3);
  });

  test("reset() with custom values", () => {
    const form = createForm({
      initialValues: { a: 1 },
    });

    form.values.a = 2;
    form.reset({ a: 10 });
    expect(form.values.a).toBe(10);
    expect(form.isChanged).toBe(false); // isChanged is against the NEW initialValues? 
    // Actually, createForm stores initialValues from the constructor.
    // If reset(newVals) is called, it should ideally update the reference for isChanged.
  });
});
