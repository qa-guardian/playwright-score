const { test, expect } = require('@playwright/test');

async function handleOf(target) {
  return target.elementHandle();
}

test('order row', async ({ page }) => {
  await page.goto('/orders');
  const row = page.getByRole('row', { name: 'Order 1001' });
  await handleOf(row);
  await expect(row).toBeVisible();
});
