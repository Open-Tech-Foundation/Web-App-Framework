import { describe, expect, test } from "runtime:test";
import { editedAfterPublish } from "../components/post-dates.js";

describe("editedAfterPublish", () => {
  test("shows an update on a later day", () => {
    expect(editedAfterPublish("2026-10-05T08:00:00Z", "2026-10-03")).toBe(true);
  });

  test("hides an update on the publish day", () => {
    expect(editedAfterPublish("2026-10-03T22:15:00Z", "2026-10-03")).toBe(false);
  });

  test("hides an update dated before publication", () => {
    expect(editedAfterPublish("2026-09-30T12:00:00Z", "2026-10-03")).toBe(false);
    expect(editedAfterPublish("2025-12-31", "2026-01-01")).toBe(false);
  });

  test("compares calendar days in UTC", () => {
    // 23:30 at UTC-05:00 is 04:30 the next day in UTC.
    expect(editedAfterPublish("2026-10-03T23:30:00-05:00", "2026-10-03")).toBe(true);
    // 01:00 at UTC+05:30 is still the previous evening in UTC.
    expect(editedAfterPublish("2026-10-04T01:00:00+05:30", "2026-10-03")).toBe(false);
  });

  test("shows any valid update when the publish date is missing or invalid", () => {
    expect(editedAfterPublish("2026-10-05T08:00:00Z", undefined)).toBe(true);
    expect(editedAfterPublish("2026-10-05T08:00:00Z", "not a date")).toBe(true);
  });

  test("hides a missing or invalid update", () => {
    expect(editedAfterPublish(undefined, "2026-10-03")).toBe(false);
    expect(editedAfterPublish("", "2026-10-03")).toBe(false);
    expect(editedAfterPublish("garbage", "2026-10-03")).toBe(false);
  });
});
