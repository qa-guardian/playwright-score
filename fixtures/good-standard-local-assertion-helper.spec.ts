import { test, expect, type Page } from '@playwright/test';

// Deliberately not named assert*/verify*/expect*/audit* or ending in
// ToBe*/ToHave* — the point is that this is recognized purely because its
// own body contains a real expect() call, not because of its name.
async function checkFlashMessageVisibility(page: Page, message: string) {
  const flashMessage = page.getByText(message);
  await expect(flashMessage).toBeVisible();
}

test.describe('flash message', () => {
  test('shows via a helper with an unrecognizable name', async ({ page }) => {
    await page.goto('/settings');
    await checkFlashMessageVisibility(page, 'Saved');
  });
});
