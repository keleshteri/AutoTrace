import { expect, test } from "@playwright/test";
import { mockTauriInitScript } from "./mockTauri";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(mockTauriInitScript());
});

test("app boots and shows calendar shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Track", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /Timer/i })).toBeVisible();
});

test("timer shows time since last break when idle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Timer/i }).click();
  await expect(page.getByText("Time since last break").first()).toBeVisible();
  await expect(page.locator(".timer-time").first()).toHaveText(/8:2\d/);
});

test("start focus switches ring to focus elapsed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Timer/i }).click();
  await page.locator(".timer-ctrl.play").first().click();
  await page.getByRole("menuitem", { name: "Start Focus" }).click();
  await page.getByRole("button", { name: /^Start Focus$/i }).click();
  await expect(page.getByText("Focus time elapsed").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".timer-time").first()).toHaveText(/0:0\d/);
});

test("status bar mirrors since-break clock", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".status-bar")).toContainText(/8:2\d/, {
    timeout: 15_000,
  });
});
