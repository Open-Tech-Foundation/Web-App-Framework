import { test, expect } from "runtime:test";
import { createForm } from "../index.js";
import { effect, signal, batch } from "@opentf/web/signals";

test("register() returns reactive metadata", async () => {
  const form = createForm({
    initialValues: { username: "" },
    validator: (v) => {
      const errors = {};
      if (!v.username) errors.username = "Required";
      return { errors };
    },
    mode: "onChange"
  });

  const field = form.register("username");
  
  expect(field.name).toBe("username");
  expect(field.error.value).toBe("Required"); // Validated on init due to onChange mode
  expect(field.isTouched.value).toBe(false);

  // Update value to clear error
  form.values.username = "valid";
  expect(field.error.value).toBeUndefined();

  // Trigger touch
  field.onblur();
  expect(field.isTouched.value).toBe(true);
});

test("register() handles nested metadata", () => {
  const form = createForm({
    initialValues: { profile: { firstName: "" } },
    validator: (v) => {
      const errors = {};
      if (!v.profile?.firstName) errors.profile = { firstName: "Required" };
      return { errors };
    }
  });

  const field = form.register("profile.firstName");
  
  expect(field.name).toBe("profile.firstName");
  expect(field.isTouched.value).toBe(false);

  // Manual touch
  field.onblur();
  expect(field.isTouched.value).toBe(true);

  // Manual error update
  form._signals.errors.value = { profile: { firstName: "Too short" } };
  form._notifySignals("e"); // Manual notify
  expect(field.error.value).toBe("Too short");
});

test("register() metadata is reactive in effects", () => {
  const form = createForm({
    initialValues: { email: "" }
  });

  const field = form.register("email");
  let caughtError = null;
  let caughtTouched = null;

  effect(() => {
    caughtError = field.error.value;
    caughtTouched = field.isTouched.value;
  });

  expect(caughtError).toBeUndefined();
  expect(caughtTouched).toBe(false);

  // Update state
  batch(() => {
    form._signals.errors.value = { email: "Invalid" };
    form._signals.touched.value = { email: true };
    form._notifySignals("e");
    form._notifySignals("t");
  });

  expect(caughtError).toBe("Invalid");
  expect(caughtTouched).toBe(true);
});
