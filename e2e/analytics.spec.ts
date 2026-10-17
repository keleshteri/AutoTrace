import { expect, test } from "@playwright/test";
import { mockTauriInitScript } from "./mockTauri";

const SHOTS = process.env.SHOT_DIR;

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(mockTauriInitScript());
  await page.addInitScript(() => localStorage.setItem("autotrace.whatsNew.seen", "0.1.1"));
});

async function shot(page: import("@playwright/test").Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("tracked time pivots, drills down and switches tabs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tracked Time" }).click();
  await expect(page.getByRole("heading", { name: "Tracked Time" })).toBeVisible();
  await expect(page.locator(".tt-table tbody tr").first()).toBeVisible();
  await expect(page.getByText("Billing revamp").first()).toBeVisible();
  await shot(page, "01-tracked-time");

  await page.getByLabel("Rows by").selectOption("app");
  await expect(page.locator(".tt-rowhead", { hasText: "Slack" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Charts" }).click();
  await expect(page.locator(".viz svg")).toBeVisible();
  await shot(page, "02-tracked-charts");

  await page.getByRole("tab", { name: "Tables" }).click();
  await page.locator(".tt-cell button").first().click();
  await expect(page.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".tt-log-table tbody tr").first()).toBeVisible();
});

test("dashboards: open pinned dashboard from sidebar and from template", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dashboards", exact: true }).first().click();
  await expect(page.getByText("Templates · 3")).toBeVisible();
  await shot(page, "03-dashboards");
  await page.getByRole("button", { name: "Use →" }).first().click();
  await expect(page.getByRole("heading", { name: "Weekly timesheet" })).toBeVisible();
  await page.getByRole("button", { name: "Client hours" }).click();
  await expect(page.getByRole("heading", { name: "Client hours" })).toBeVisible();
  await expect(page.getByText("Northstar Labs").first()).toBeVisible();
});

test("reports show AI summary and local insights", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByText("AI Summary")).toBeVisible();
  await expect(page.getByText("Best block: Billing revamp")).toBeVisible();
  await expect(page.getByText("Tracked time is 38% below the previous period")).toBeVisible();
  await shot(page, "04-reports");
});

test("routines list, toggle and run now", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Routines", exact: true }).click();
  await expect(page.getByText("Weekdays at 8:30 AM")).toBeVisible();
  await shot(page, "05-routines");
  await page.getByRole("button", { name: "Run End of day now" }).click();
  await expect(page.getByRole("dialog", { name: "Run output" })).toBeVisible();
  await expect(page.getByText("Best block: Billing revamp")).toBeVisible();
});

test("resourcing shows capacity chart and overbooked week", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Resourcing" }).click();
  await expect(page.getByText("Tracked vs planned · cumulative")).toBeVisible();
  await expect(page.locator(".load-bar").first()).toBeVisible();
  await shot(page, "06-resourcing");
});

test("meetings list and detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Meetings" }).click();
  await expect(page.getByRole("heading", { name: "Daily Code Pairing + Sync" })).toBeVisible();
  await page.getByRole("button", { name: "I will attend" }).click();
  await shot(page, "07-meetings");
  await page.getByText("Weekly Sync - Model Optimization").click();
  await expect(page.getByText("Mockups for packaging refresh are done")).toBeVisible();
});

test("focus page shows overview, distractions and silent mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByText("Today's focus")).toBeVisible();
  await expect(page.getByText("mail.superhuman.com")).toBeVisible();
  await page.getByRole("button", { name: /Silent mode/ }).click();
  await expect(page.getByRole("button", { name: /Silent mode on/ })).toBeVisible();
  await shot(page, "08-focus");
});

test("agent chat @mention autocomplete adds a chip", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const box = page.locator(".agent-composer textarea");
  await box.click();
  await box.pressSequentially("How is @North");
  await expect(page.getByRole("option", { name: /Northstar Labs/ }).first()).toBeVisible();
  await shot(page, "09-mentions");
  await box.press("Enter");
  await expect(page.locator(".mention-chip", { hasText: "Northstar Labs" })).toBeVisible();
  await expect(box).toHaveValue(/@Northstar Labs /);
});

test("what's new tour opens from help menu", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Help & feedback" }).click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  await expect(page.getByRole("dialog", { name: "What's new in AutoTrace" })).toBeVisible();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.getByText("See where time goes in seconds")).toBeVisible();
  await shot(page, "10-whats-new");
});
