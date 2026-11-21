import { test, expect } from '@playwright/test';

// QAG-196 baseline (2026-09-21): a spec built from exactly these tricks
// scored 93/A under model v3 before pwscore/no-timer-sleep and
// pwscore/no-trivial-assertion existed. Each test below isolates one
// trick. (The soft-assertion-only and fixed-coordinate-click tricks were
// removed in QAG-287 together with their rules.)

test.describe('gameable patterns', () => {
  test('sleeps instead of waiting for a condition', async ({ page }) => {
    await page.goto('/app');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('asserts on a literal constant', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Submit' }).click();
    expect(true).toBe(true);
  });

});
