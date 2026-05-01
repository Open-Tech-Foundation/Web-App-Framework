import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import { createForm } from "../index.js";
import { sleep } from "@opentf/std";

const StateForm = ({ onSubmit }) => {
  const form = createForm({
    mode: "onChange", // Use onChange for easier testing of reactive text
    initialValues: { username: "alice" },
    validate: (v) => v.username.length < 3 ? { username: "Too short" } : {}
  });

  return (
    <form onsubmit={form.handleSubmit(onSubmit)}>
      <input {...form.register("username")} data-testid="username" />
      
      <div data-testid="status-valid">{form.isValid ? "Valid" : "Invalid"}</div>
      <div data-testid="status-changed">{form.isChanged ? "Changed" : "Unchanged"}</div>
      <div data-testid="status-touched">{form.isTouched ? "Touched" : "Untouched"}</div>
      
      {form.errors.username && <span data-testid="error">{form.errors.username}</span>}
      
      <button type="button" onclick={() => form.reset()} data-testid="reset">Reset</button>
      <button type="submit" data-testid="submit">Submit</button>
      
      {form.isSubmitted && <div data-testid="success">Submitted!</div>}
    </form>
  );

};

const waitFor = async (fn, timeout = 1000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch (e) {
      await sleep(10);
    }
  }
  fn();
};

describe("Form State UI Reactivity", () => {
  test("updates UI based on state helpers", async () => {
    let submitted = false;
    const { getByTestId, queryByTestId } = render(StateForm, { onSubmit: async () => {
      submitted = true;
    }});
    const user = userEvent.setup();

    const input = getByTestId("username");
    const statusValid = getByTestId("status-valid");
    const statusChanged = getByTestId("status-changed");
    const statusTouched = getByTestId("status-touched");
    const resetBtn = getByTestId("reset");
    const submitBtn = getByTestId("submit");

    // Initial state
    expect(statusValid.textContent).toBe("Valid");

    // Change value to invalid
    await user.clear(input);
    await user.type(input, "ab");
    expect(statusValid.textContent).toBe("Invalid");
    expect(statusChanged.textContent).toBe("Changed");
    expect(getByTestId("error").textContent).toBe("Too short");

    // Submit valid data
    await user.clear(input);
    await user.type(input, "bob");
    await user.click(submitBtn);
    
    await waitFor(() => expect(submitted).toBe(true));
    await waitFor(() => expect(getByTestId("success")).toBeTruthy());

    // Reset
    await user.click(resetBtn);
    expect(input.value).toBe("alice");
    expect(statusChanged.textContent).toBe("Unchanged");
    expect(queryByTestId("success")).toBeNull();
  });
});
