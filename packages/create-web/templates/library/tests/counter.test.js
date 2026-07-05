import { expect, test } from "bun:test";
import { render, userEvent } from "@opentf/web-test";
import Counter from "../src/Counter.jsx";

test("Counter increments on click", async () => {
  const { getByTestId } = render(Counter, { initial: 1 });
  const user = userEvent.setup();
  const button = getByTestId("counter");

  expect(button.textContent).toContain("1");
  await user.click(button);
  expect(button.textContent).toContain("2");
});