import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import { createForm } from "../index.js";

export function ProfileForm() {
  const form = createForm({
    initialValues: { 
      user: { name: "John" },
      tags: ["js"]
    },
    validate: (v) => {
      const errors = {};
      if (v.user.name.length < 3) errors.user = { name: "Too short" };
      return errors;
    }
  });

  const addTag = () => form.values.tags.push(`tag-${form.values.tags.length}`);

  return (
    <div>
      <h1 data-testid="title">{form.values.user.name}</h1>
      <input {...form.register("user.name")} data-testid="name-input" />
      <div data-testid="name-error">{form.errors.user?.name}</div>
      
      <ul data-testid="tag-list">
        {form.values.tags.map((tag, i) => (
          <li data-testid={`tag-${i}`}>{tag}</li>
        ))}
      </ul>
      <button onclick={addTag} data-testid="add-tag">Add Tag</button>
      
      <div data-testid="status">{form.isValid ? "Valid" : "Invalid"}</div>
    </div>
  );
}

describe("Web Form Component Integration", () => {
  test("updates nested values and validation state in UI", async () => {
    const { getByTestId } = render(ProfileForm);
    const user = userEvent.setup();
    
    const input = getByTestId("name-input");
    const error = getByTestId("name-error");
    const status = getByTestId("status");
    const title = getByTestId("title");

    expect(title.textContent).toBe("John");
    expect(status.textContent).toBe("Valid");

    await user.clear(input);
    await user.type(input, "Jo");
    // Mode is onBlur by default, so we need to blur
    await user.tab();

    expect(title.textContent).toBe("Jo");
    expect(error.textContent).toBe("Too short");
    expect(status.textContent).toBe("Invalid");

    await user.type(input, "hnny");
    await user.tab();
    expect(error.textContent).toBe("");
    expect(status.textContent).toBe("Valid");
  });

  test("handles dynamic array mutations in UI", async () => {
    const { getByTestId, getAllByRole } = render(ProfileForm);
    const user = userEvent.setup();

    const list = getByTestId("tag-list");
    const addBtn = getByTestId("add-tag");

    expect(list.children.length).toBe(1);
    
    await user.click(addBtn);
    expect(list.children.length).toBe(2);
    expect(getByTestId("tag-1").textContent).toBe("tag-1");
  });
});
