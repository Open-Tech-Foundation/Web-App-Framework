import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import BasicForm from "./BasicForm.jsx";

describe("Basic Form", () => {
  test("initializes and handles submission", async () => {
    let submittedValues = null;
    const { getByTestId, queryByTestId } = render(BasicForm, { 
      onSubmit: (v) => submittedValues = v 
    });
    const user = userEvent.setup();

    const username = getByTestId("username");
    const email = getByTestId("email");
    const submit = getByTestId("submit");

    expect(username.value).toBe("alice");
    expect(email.value).toBe("");

    // Try to submit with invalid email
    await user.click(submit);
    expect(submittedValues).toBeNull();
    expect(getByTestId("email-error").textContent).toBe("Invalid email");

    // Correct the email
    await user.type(email, "alice@example.com");
    expect(queryByTestId("email-error")).toBeNull();

    // Change username
    await user.clear(username);
    await user.type(username, "bob");
    
    // Submit
    await user.click(submit);
    expect(submittedValues).toEqual({ username: "bob", email: "alice@example.com" });
  });
});
