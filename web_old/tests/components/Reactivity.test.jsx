import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import DynamicListForm from "./DynamicListForm.jsx";

describe("Component Testing Library", () => {
  test("renders component and allows user interaction", async () => {
    const { getByTestId } = render(DynamicListForm);
    const user = userEvent.setup();

    // Verify initial render
    const input0 = getByTestId("input-0");
    const input1 = getByTestId("input-1");
    expect(input0.value).toBe("JavaScript");
    expect(input1.value).toBe("HTML");

    // Simulate typing in the first input
    await user.type(input0, "!");

    // Verify the value updated reactively
    expect(input0.value).toBe("JavaScript!");
    
    // Assert that the input is STILL the exact same DOM node (element was not recreated)
    // We can verify this by checking if it still has focus, as user.type leaves focus on the element
    expect(document.activeElement).toBe(input0);
  });
});
