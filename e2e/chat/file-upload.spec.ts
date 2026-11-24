import { expect, test } from "../fixtures";

/**
 * File upload happy path E2E tests.
 * @tags @integration
 */

test.describe("File Upload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("file attachment button is visible", async ({ page }) => {
    const attachButton = page.getByTestId("attach-file-button");
    await expect(attachButton).toBeVisible({ timeout: 15_000 });
  });

  test("file input accepts CSV files @integration", async ({ page }) => {
    const attachButton = page.getByTestId("attach-file-button");
    await expect(attachButton).toBeVisible({ timeout: 15_000 });

    const fileInput = page.getByTestId("file-input");

    // Upload a small CSV
    await fileInput.setInputFiles({
      name: "test-data.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Name,Value\nfoo,bar\nbaz,qux\n"),
    });

    // Wait for file badge to appear
    await expect(page.getByText("test-data.csv")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("file can be removed after attachment", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    await fileInput.setInputFiles({
      name: "remove-me.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("A,B\n1,2\n"),
    });

    // Wait for badge
    await expect(page.getByText("remove-me.csv")).toBeVisible({
      timeout: 10_000,
    });

    // Click remove button (first one)
    const removeButton = page.getByTestId("remove-attachment").first();
    await removeButton.click();

    // Badge should be gone
    await expect(page.getByText("remove-me.csv")).not.toBeVisible();
  });

  test("rejects unsupported file types with toast", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    await fileInput.setInputFiles({
      name: "tool.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ fake executable"),
    });

    // Should show toast error
    await expect(page.getByText("Unsupported file type").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("supports multiple file attachments @integration", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    // Attach 2 CSV files at once via multi-select
    await fileInput.setInputFiles([
      {
        name: "file-a.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("A,B\n1,2\n"),
      },
      {
        name: "file-b.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("X,Y\n3,4\n"),
      },
    ]);

    // Both file badges should appear
    await expect(page.getByText("file-a.csv")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("file-b.csv")).toBeVisible({
      timeout: 10_000,
    });

    // Should have 2 remove buttons
    const removeButtons = page.getByTestId("remove-attachment");
    await expect(removeButtons).toHaveCount(2);
  });
});
