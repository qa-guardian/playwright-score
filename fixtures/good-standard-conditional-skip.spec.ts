import { test, expect } from '@playwright/test';

test.describe('cross-browser feature', () => {
  test('uses picture-in-picture where supported', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'PIP has restrictions on Safari/WebKit');

    await page.goto('/video');
    await expect(page.getByRole('button', { name: 'PIP' })).toBeVisible();
  });
});
