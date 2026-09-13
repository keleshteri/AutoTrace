import { describe, expect, it } from "vitest";
import { SESSION_CATEGORIES, todayLocal } from "./api";

describe("api helpers", () => {
  it("exposes session categories used by calendar / focus", () => {
    expect(SESSION_CATEGORIES).toContain("Focus");
    expect(SESSION_CATEGORIES).toContain("Meeting");
    expect(SESSION_CATEGORIES).toContain("Break");
  });

  it("todayLocal is YYYY-MM-DD", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
