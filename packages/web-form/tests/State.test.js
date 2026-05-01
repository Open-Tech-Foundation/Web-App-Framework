import { expect, test, describe } from "bun:test";
import { createForm } from "../index.js";
import { sleep } from "@opentf/std";

describe("Web App Framework Forms Library - State Helpers", () => {
  test("isValid tracks error state", () => {
    const form = createForm({
      mode: "onChange",
      initialValues: { name: "" },
      validate: (v) => v.name ? {} : { name: "Error" }
    });
    
    expect(form.isValid).toBe(false);
    form.values.name = "Alice";
    expect(form.isValid).toBe(true);
  });

  test("isChanged tracks deep equality with initial values", () => {
    const form = createForm({
      initialValues: { user: { name: "Alice" } }
    });
    
    expect(form.isChanged).toBe(false);
    expect(form.changed.user).toBe(false);
    
    form.values.user = { name: "Bob" };
    expect(form.isChanged).toBe(true);
    expect(form.changed.user).toBe(true);
    
    form.values.user = { name: "Alice" };
    expect(form.isChanged).toBe(false);
    expect(form.changed.user).toBe(false);
  });

  test("isTouched tracks field blur state", () => {
    const form = createForm({
      initialValues: { email: "" }
    });
    const { onblur } = form.register("email");
    
    expect(form.isTouched).toBe(false);
    expect(form.touched.email).toBe(false);
    
    onblur();
    expect(form.isTouched).toBe(true);
    expect(form.touched.email).toBe(true);
  });

  test("isSubmitting and isSubmitted lifecycle", async () => {
    let resolved = false;
    const form = createForm({
      initialValues: { name: "Alice" }
    });
    
    const onSubmit = async () => {
      await sleep(50);
      resolved = true;
    };
    
    const handler = form.handleSubmit(onSubmit);
    
    expect(form.isSubmitting).toBe(false);
    expect(form.isSubmitted).toBe(false);
    
    const promise = handler();
    expect(form.isSubmitting).toBe(true);
    
    await promise;
    expect(resolved).toBe(true);
    expect(form.isSubmitting).toBe(false);
    expect(form.isSubmitted).toBe(true);
  });

  test("reset() restores initial state", () => {
    const form = createForm({
      initialValues: { count: 0 }
    });
    
    form.values.count = 10;
    form.register("count").onblur();
    
    expect(form.values.count).toBe(10);
    expect(form.isChanged).toBe(true);
    expect(form.isTouched).toBe(true);
    
    form.reset();
    
    expect(form.values.count).toBe(0);
    expect(form.isChanged).toBe(false);
    expect(form.isTouched).toBe(false);
  });

});
