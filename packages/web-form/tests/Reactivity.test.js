import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import DynamicPrimitiveForm from "./DynamicListForm.jsx";

describe("Web Form Capabilities", () => {
  test("reactively updates dynamic primitive arrays without losing focus", async () => {
    const { getByTestId } = render(DynamicPrimitiveForm);
    const user = userEvent.setup();

    const input0 = getByTestId("input-0");
    const input1 = getByTestId("input-1");
    
    expect(input0.value).toBe("JavaScript");
    expect(input1.value).toBe("HTML");

    // Simulate typing a new character into the first input
    await user.type(input0, "!");

    // The value should update immediately via the form's reactivity loop
    expect(input0.value).toBe("JavaScript!");
    
    // Crucially, the exact same DOM node should be retained (focus proves this).
    // The node must not be destroyed and recreated.
    expect(document.activeElement).toBe(input0);
  });
});
