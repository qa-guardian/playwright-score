import { test, expect } from '@playwright/test';

// Fixture: hand-rolled polling waits are not retry/backoff pacing. No
// try/catch, so a top-level helper polling the UI is flagged, and so is a
// helper declared inside a test callback.
async function waitForSpinnerGone(page) {
  while (await page.locator('.spinner').isVisible()) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test('polls through a top-level helper', async ({ page }) => {
  await waitForSpinnerGone(page);
  await expect(page.locator('h1')).toBeVisible();
});

test('polls through a helper declared in the test', async ({ page }) => {
  const pause = async () => {
    for (const _ of [1]) await new Promise((r) => setTimeout(r, 5000));
  };
  await pause();
  await expect(page.locator('h1')).toBeVisible();
});

// A bounded retry loop (it can break/return/throw when it succeeds or runs out)
// is pacing, not a wait, wherever the helper is declared (QAG-287 slice E2):
// not flagged.
test('retry helper nested in the test', async ({ page }) => {
  async function retry() {
    for (let i = 0; i < 3; i++) {
      try {
        await page.reload();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  await retry();
  await expect(page.locator('h1')).toBeVisible();
});
