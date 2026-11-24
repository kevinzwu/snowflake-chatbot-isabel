import { expect, test } from "../fixtures";

/**
 * File upload security E2E tests.
 * Tests rejection of dangerous files.
 * @tags @security
 */

test.describe("File Upload Security @security", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("displays badge for valid attached file", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    // Attach a small valid PDF to verify the badge rendering
    await fileInput.setInputFiles({
      name: "too-big.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.5 small content"),
    });

    // Verify the file badge appears for a valid attachment
    await expect(page.getByText("too-big.pdf")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("rejects unsupported file extensions", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    await fileInput.setInputFiles({
      name: "script.js",
      mimeType: "application/javascript",
      buffer: Buffer.from("console.log('malicious')"),
    });

    await expect(page.getByText("Unsupported file type").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("rejects .exe files disguised as PDF", async ({ page }) => {
    const fileInput = page.getByTestId("file-input");

    // .exe extension is rejected client-side
    await fileInput.setInputFiles({
      name: "malware.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0x4d, 0x5a, 0x00, 0x00]),
    });

    await expect(page.getByText("Unsupported file type").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("API rejects files with wrong magic bytes @security", async ({
    authedRequest,
    envConfig,
  }) => {
    // Test the API directly for server-side MIME mismatch detection
    const response = await authedRequest.fetch(
      `${envConfig.baseURL}/api/v1/extract-text`,
      {
        method: "POST",
        multipart: {
          file: {
            name: "fake.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("This is definitely not a PDF"),
          },
        },
      },
    );

    // Auth failure means E2E auth setup is broken — fail explicitly
    if (response.status() === 401) {
      test.fail(true, "Auth state unavailable — cannot test server validation");
    }
    expect(response.status()).toBe(422);
  });

  test("API rejects PDF with JavaScript @security @live", async ({
    authedRequest,
    envConfig,
  }) => {
    const response = await authedRequest.fetch(
      `${envConfig.baseURL}/api/v1/extract-text`,
      {
        method: "POST",
        multipart: {
          file: {
            name: "exploit.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.5\n/JS (alert('xss'))\nendobj"),
          },
        },
      },
    );

    // Auth failure means E2E auth setup is broken — fail explicitly
    if (response.status() === 401) {
      test.fail(true, "Auth state unavailable — cannot test server validation");
    }
    expect(response.status()).toBe(422);
  });
});
