import { expect, test, describe } from "runtime:test";
import { mount, type, clear, click, tab } from "./dom.js";
import ProfileForm from "./ProfileForm.jsx";

describe("Web Form Component Integration", () => {
  test("updates nested values and validation state in UI", async () => {
    const { getByTestId } = mount(ProfileForm);

    const input = getByTestId("name-input");
    const error = getByTestId("name-error");
    const status = getByTestId("status");
    const title = getByTestId("title");

    expect(title.textContent).toBe("John");
    expect(status.textContent).toBe("Valid");

    await clear(input);
    await type(input, "Jo");
    // Mode is onBlur by default, so we need to blur
    await tab();

    expect(title.textContent).toBe("Jo");
    expect(error.textContent).toBe("Too short");
    expect(status.textContent).toBe("Invalid");

    await type(input, "hnny");
    await tab();
    expect(error.textContent).toBe("");
    expect(status.textContent).toBe("Valid");
  });

  test("handles dynamic array mutations in UI", async () => {
    const { getByTestId, getAllByRole } = mount(ProfileForm);

    const list = getByTestId("tag-list");
    const addBtn = getByTestId("add-tag");

    expect(list.children.length).toBe(1);

    await click(addBtn);
    expect(list.children.length).toBe(2);
    expect(getByTestId("tag-1").textContent).toBe("tag-1");
  });
});
