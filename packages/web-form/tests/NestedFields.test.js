import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import NestedForm from "./NestedForm.jsx";

describe("Nested Fields", () => {
  test("handles deep object paths", async () => {
    let submittedValues = null;
    const { getByTestId } = render(NestedForm, { 
      onSubmit: (v) => submittedValues = v 
    });
    const user = userEvent.setup();

    const firstName = getByTestId("first-name");
    const notifications = getByTestId("notifications");
    const submit = getByTestId("submit");

    expect(firstName.value).toBe("John");
    expect(notifications.checked).toBe(true);

    await user.clear(firstName);
    await user.type(firstName, "Jane");
    await user.click(notifications); // Uncheck

    await user.click(submit);
    expect(submittedValues.user.profile.firstName).toBe("Jane");
    expect(submittedValues.user.settings.notifications).toBe(false);
  });
});
