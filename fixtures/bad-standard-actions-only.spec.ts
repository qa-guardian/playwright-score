import { test } from '@playwright/test';

// Fixture: only navigates and clicks. No assertion anywhere, and nothing
// the test calls could hide one (every call is the Playwright API on
// `page`), so this must stay an expect-expect error.
test('opens the pricing page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Pricing' }).click();
});

test('submits the form', async ({ page }) => {
  await page.goto('/contact');
  const send = page.getByRole('button', { name: 'Send' });
  await send.click();
});
