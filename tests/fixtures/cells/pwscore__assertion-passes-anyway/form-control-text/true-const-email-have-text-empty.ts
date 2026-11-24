import { test, expect } from '@playwright/test';

test('invite form resets the address', async ({ page }) => {
  await page.goto('/team/invite');
  const address = page.locator('input[type=email]');
  await address.fill('new.member@example.com');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(address).toHaveText('');
});
