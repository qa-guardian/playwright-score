import { test, expect } from '@playwright/test';

// QAG-196 baseline (2026-09-21): a spec built from exactly these four
// tricks scored 93/A under model v3 before pwscore/no-timer-sleep,
// pwscore/no-coordinate-click, pwscore/no-trivial-assertion and
// pwscore/no-soft-assertion-only-test existed. Each test below isolates
// one trick.

test.describe('gameable patterns', () => {
  test('sleeps instead of waiting for a condition', async ({ page }) => {
    await page.goto('/app');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('clicks a fixed coordinate instead of a locator', async ({ page }) => {
    await page.goto('/app');
    await page.mouse.click(120, 240);
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('asserts on a literal constant', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Submit' }).click();
    expect(true).toBe(true);
  });

  test('uses only soft assertions', async ({ page }) => {
    await page.goto('/app');
    await expect.soft(page.getByRole('heading')).toBeVisible();
    await expect.soft(page.getByText('Saved')).toBeVisible();
  });
});
