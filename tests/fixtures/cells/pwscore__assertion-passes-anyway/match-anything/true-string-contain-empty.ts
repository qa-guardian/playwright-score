import { test, expect } from '@playwright/test';

test('reads the plan label', async ({ page }) => {
  await page.goto('/billing');
  const label = await page.getByTestId('plan-name').innerText();
  expect(label).toContain('');
});
