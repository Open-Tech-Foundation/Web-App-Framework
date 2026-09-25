import { expect, test, describe } from "runtime:test";
import { mount, type, clear, click } from "./dom.js";
import NestedForm from "./NestedForm.compiled.js";

describe("Nested Fields", () => {
  test("handles deep object paths", async () => {
    let submittedValues = null;
    const { getByTestId } = mount(NestedForm, { 
      onSubmit: (v) => submittedValues = v 
    });

    const firstName = getByTestId("first-name");
    const notifications = getByTestId("notifications");
    const submit = getByTestId("submit");

    expect(firstName.value).toBe("John");
    expect(notifications.checked).toBe(true);

    await clear(firstName);
    await type(firstName, "Jane");
    await click(notifications); // Uncheck

    await click(submit);
    expect(submittedValues.user.profile.firstName).toBe("Jane");
    expect(submittedValues.user.settings.notifications).toBe(false);
  });
});
