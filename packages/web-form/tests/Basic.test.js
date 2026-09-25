import { expect, test, describe } from "runtime:test";
import { mount, type, clear, click } from "./dom.js";
import BasicForm from "./BasicForm.compiled.js";

describe("Basic Form", () => {
  test("initializes and handles submission", async () => {
    let submittedValues = null;
    const { getByTestId, queryByTestId } = mount(BasicForm, { 
      onSubmit: (v) => submittedValues = v 
    });

    const username = getByTestId("username");
    const email = getByTestId("email");
    const submit = getByTestId("submit");

    expect(username.value).toBe("alice");
    expect(email.value).toBe("");

    // Try to submit with invalid email
    await click(submit);
    expect(submittedValues).toBeNull();
    expect(getByTestId("email-error").textContent).toBe("Invalid email");

    // Correct the email
    await type(email, "alice@example.com");
    expect(queryByTestId("email-error")).toBeNull();

    // Change username
    await clear(username);
    await type(username, "bob");
    
    // Submit
    await click(submit);
    expect(submittedValues).toEqual({ username: "bob", email: "alice@example.com" });
  });
});
