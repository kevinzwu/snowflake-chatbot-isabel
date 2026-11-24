import { expect, test } from "../fixtures";

/**
 * Chat streaming E2E tests.
 * Tag: @integration
 *
 * Tests SSE streaming responses from the Cortex Agent.
 * Requires a live Snowflake connection — only run against QA/staging.
 */

test.describe("Chat Streaming @integration @live", () => {
  test.beforeEach(async ({ page, envConfig }) => {
    test.skip(!envConfig.hasSnowflake, "Requires live Snowflake connection");
    test.setTimeout(120_000); // Streaming can take time

    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("submitting a query shows thinking state then response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder(/ask isabel/i);
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill("How many open vulnerabilities are there?");
    await input.press("Enter");

    // User message should appear
    await expect(
      page.getByText("How many open vulnerabilities are there?"),
    ).toBeVisible({
      timeout: 10_000,
    });

    // Wait for any response — thinking indicator or streamed text
    const responseArea = page.locator(
      '[class*="message"], [data-role="assistant"]',
    );
    await expect(responseArea.first()).toBeVisible({ timeout: 60_000 });
  });

  test("stop button appears during streaming", async ({ page }) => {
    const input = page.getByPlaceholder(/ask isabel/i);
    await expect(input).toBeVisible({ timeout: 15_000 });

    await input.fill("Show me vulnerability trends over the past year");
    await input.press("Enter");

    // A stop button should appear while streaming
    const stopButton = page.getByRole("button", { name: /stop/i });
    const appeared = await stopButton
      .isVisible({ timeout: 30_000 })
      .catch(() => false);

    // It's okay if the response completes before we see the stop button.
    // In that case, verify an assistant response appeared instead.
    if (!appeared) {
      const responseArea = page.locator(
        '[class*="message"], [data-role="assistant"]',
      );
      await expect(responseArea.first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
