import { expect, test, describe, spyOn } from "bun:test";
import { render, cleanup, userEvent } from "@opentf/web-test";
import { CompilerCore } from "./CompilerCore.jsx";
import { LifecycleCore } from "./LifecycleCore.jsx";

describe("OpenTF Web - Comprehensive Suite", () => {
  describe("Compiler Core Features", () => {
    test("renders basic JSX and handles dynamic props", async () => {
      const { getByTestId, getByText } = render(CompilerCore, { 
        staticProp: "hello",
        dynamicProp: "world"
      });

      expect(getByTestId("title").textContent).toBe("Compiler Core Test");
      expect(getByText("Static: hello")).toBeTruthy();
      expect(getByText("Dynamic: world")).toBeTruthy();
      
      const root = document.getElementById("compiler-root");
      expect(root.style.color).toBe("blue");
    });

    test("handles reactivity (signals, events, styles)", async () => {
      const { getByTestId } = render(CompilerCore);
      const user = userEvent.setup();
      const btn = getByTestId("inc-btn");

      expect(btn.textContent).toContain("0");
      await user.click(btn);
      expect(btn.textContent).toContain("1");
    });

    test("handles conditional rendering", async () => {
      const { getByTestId, queryByTestId } = render(CompilerCore);
      const user = userEvent.setup();
      const toggle = getByTestId("toggle-btn");

      expect(getByTestId("visible-div")).toBeTruthy();
      await user.click(toggle);
      expect(queryByTestId("visible-div")).toBeNull();
    });

    test("handles list rendering (mapped)", async () => {
      const { getByTestId } = render(CompilerCore);
      expect(getByTestId("item-0").textContent).toContain("A");
      expect(getByTestId("item-1").textContent).toContain("B");
      expect(getByTestId("item-2").textContent).toContain("C");
    });

    test("handles spread attributes", async () => {
      const { container } = render(CompilerCore);
      const spreadDiv = container.querySelector("#spread-id");
      expect(spreadDiv).toBeTruthy();
      expect(spreadDiv.getAttribute("data-attr")).toBe("spread-val");
    });
  });

  describe("Lifecycle Hooks", () => {
    test("triggers onMount and onCleanup", async () => {
      const events = [];
      const onEvent = (e) => events.push(e);

      const { unmount } = render(LifecycleCore, { onEvent });
      
      expect(events).toContain("mounted");
      
      // We need to implement unmount in our testing lib or do it manually
      cleanup(); 
      expect(events).toContain("cleaned");
    });
  });
});
