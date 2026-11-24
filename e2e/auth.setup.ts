import { expect, test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";

const authFile = path.join(__dirname, "../playwright/.auth/user.json");

// Ensure the auth directory exists before writing storage state
fs.mkdirSync(path.dirname(authFile), { recursive: true });

/**
 * Authentication setup project. Saves browser state for reuse across all test
 * projects.
 *
 * Demo mode (default): the app runs with DEV_AUTH=true, so this clicks
 * "Dev Login". Start it with `pnpm demo:setup` and `pnpm exec next dev`.
 *
 * Azure AD (E2E_AUTH=azure, for @live tests against a real deployment):
 *   E2E_TEST_USER_EMAIL    — Azure AD test account email
 *   E2E_TEST_USER_PASSWORD — Azure AD test account password
 * Without credentials an empty auth state is saved, and tests that need
 * a session fail or are skipped.
 */
setup("authenticate", async ({ page }) => {
  if (process.env.E2E_AUTH === "azure") {
    await authenticateWithAzureAd(page);
  } else {
    await authenticateWithDevLogin(page);
  }
  await page.context().storageState({ path: authFile });
});

async function authenticateWithDevLogin(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/auth/signin");
  await page.getByRole("button", { name: /dev login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
    timeout: 30_000,
  });
  await expect(page.getByPlaceholder(/ask isabel/i)).toBeVisible({
    timeout: 15_000,
  });
}

async function authenticateWithAzureAd(
  page: import("@playwright/test").Page,
): Promise<void> {
  const email = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;

  if (!email || !password) {
    console.warn(
      "E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD not set. " +
        "Saving empty auth state; authenticated tests will fail or be skipped.",
    );
    return;
  }

  // Navigate to the app. The middleware redirects to the sign-in page.
  await page.goto("/auth/signin");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for Azure AD login page
  await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 15_000 });

  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByRole("button", { name: /next/i }).click();

  // Azure AD sometimes uses a separate page for the password
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Handle "Stay signed in?" prompt if it appears
  const staySignedIn = page.getByRole("button", { name: /yes/i });
  if (await staySignedIn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await staySignedIn.click();
  }

  await page.waitForURL("/", { timeout: 30_000 });

  // Verify we are authenticated: the chat input or sign-out button is visible
  await expect(
    page.getByPlaceholder(/ask isabel/i).or(page.getByText(/sign out/i)),
  ).toBeVisible({ timeout: 10_000 });
}
