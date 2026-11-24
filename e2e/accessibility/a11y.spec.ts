import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures";

/**
 * Accessibility E2E tests.
 * Tag: @a11y
 *
 * Uses axe-core to perform automated WCAG 2.1 AA compliance checks.
 */

test.describe("Accessibility @a11y", () => {
  test("main page passes axe accessibility audit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for main content to render
    await page.waitForTimeout(2_000);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .exclude("[data-testid='vega-chart']") // Charts may have known a11y issues
      .analyze();

    // Log violations for debugging
    if (results.violations.length > 0) {
      console.log("Accessibility violations:");
      for (const violation of results.violations) {
        console.log(
          `  [${violation.impact}] ${violation.id}: ${violation.description}`,
        );
        console.log(`    Affected: ${violation.nodes.length} element(s)`);
      }
    }

    // Allow minor/moderate issues but fail on serious/critical
    const seriousViolations = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousViolations).toHaveLength(0);
  });

  test("chat input is keyboard accessible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tab to the input field
    await page.keyboard.press("Tab");

    // Keep tabbing until we reach a textbox or run out of tries
    let foundInput = false;
    for (let i = 0; i < 20; i++) {
      const focused = page.locator(":focus");
      const tagName = await focused
        .evaluate((el) => el.tagName.toLowerCase())
        .catch(() => "");
      if (tagName === "textarea" || tagName === "input") {
        foundInput = true;
        break;
      }
      await page.keyboard.press("Tab");
    }

    expect(foundInput).toBe(true);
  });
});
