import { expect, test, describe } from "runtime:test";
import { mount, click } from "./dom.js";
import DynamicArrayForm from "./DynamicArrayForm.compiled.js";

describe("Dynamic Arrays", () => {
  test("adds and removes items", async () => {
    const { getByTestId, getAllByRole, queryByTestId } = mount(DynamicArrayForm);

    const addBtn = getByTestId("add-item");
    const list = getByTestId("item-list");

    expect(getAllByRole("listitem").length).toBe(1);
    expect(getByTestId("item-0").textContent).toContain("Item 1");

    // Add item
    await click(addBtn);
    expect(getAllByRole("listitem").length).toBe(2);
    expect(getByTestId("item-1").textContent).toContain("Item 2");

    // Add another
    await click(addBtn);
    expect(getAllByRole("listitem").length).toBe(3);

    // Remove middle item (Item 2 at index 1)
    await click(getByTestId("remove-1"));
    expect(getAllByRole("listitem").length).toBe(2);
    
    // Check remaining items
    expect(getByTestId("item-0").textContent).toContain("Item 1");
    expect(getByTestId("item-1").textContent).toContain("Item 3"); // Item 3 moved to index 1
  });
});
