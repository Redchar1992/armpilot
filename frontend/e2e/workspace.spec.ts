import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("boots the browser runtime with visible architecture evidence", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ArmPilot" })).toBeVisible();
  await expect(page.getByText("Browser demo", { exact: true })).toBeVisible();
  await expect(page.getByText("20 / 20 TASK EVAL")).toBeVisible();
  await expect(page.getByText("Language-grounded manipulation, visible end to end.")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan & execute" })).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});

test("executes and verifies a natural-language task end to end", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Plan & execute" }).click();

  await expect(page.getByRole("button", { name: "Executing task" })).toBeDisabled();
  await expect(page.getByText("get_scene", { exact: true })).toBeVisible();
  await expect(page.getByText("Goal verified", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect(page.getByText("Goal verified against browser scene state ✓")).toBeVisible();
  await expect(page.getByText("check_success", { exact: true })).toBeVisible();
});

test("surfaces unsupported commands and recovers through reset", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Robot instruction").fill("wave hello");
  await page.getByRole("button", { name: "Plan & execute" }).click();

  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText(/could not identify a colored block/i)).toBeVisible();
  await page.getByRole("button", { name: "Reset workcell" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
});

test("can reset an active run and immediately start a clean run", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Plan & execute" }).click();
  await expect(page.getByRole("button", { name: "Executing task" })).toBeDisabled();
  await page.getByRole("button", { name: "Reset workcell" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plan & execute" }).click();
  await expect(page.getByText("Goal verified", { exact: true })).toBeVisible({ timeout: 12_000 });
});

test("keeps primary controls reachable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan & execute" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View source on GitHub" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
