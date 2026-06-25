import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import { sleep } from "@opentf/std";
import StateForm from "./StateForm.jsx";

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
