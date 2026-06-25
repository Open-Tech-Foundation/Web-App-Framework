import { expect, test, describe } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import DynamicArrayForm from "./DynamicArrayForm.jsx";

describe("Dynamic Arrays", () => {
  test("adds and removes items", async () => {
    const { getByTestId, getAllByRole, queryByTestId } = render(DynamicArrayForm);
    const user = userEvent.setup();

    const addBtn = getByTestId("add-item");
    const list = getByTestId("item-list");

    expect(getAllByRole("listitem").length).toBe(1);
    expect(getByTestId("item-0").textContent).toContain("Item 1");

    // Add item
    await user.click(addBtn);
    expect(getAllByRole("listitem").length).toBe(2);
    expect(getByTestId("item-1").textContent).toContain("Item 2");

    // Add another
    await user.click(addBtn);
    expect(getAllByRole("listitem").length).toBe(3);

    // Remove middle item (Item 2 at index 1)
    await user.click(getByTestId("remove-1"));
    expect(getAllByRole("listitem").length).toBe(2);
    
    // Check remaining items
    expect(getByTestId("item-0").textContent).toContain("Item 1");
    expect(getByTestId("item-1").textContent).toContain("Item 3"); // Item 3 moved to index 1
  });
});
