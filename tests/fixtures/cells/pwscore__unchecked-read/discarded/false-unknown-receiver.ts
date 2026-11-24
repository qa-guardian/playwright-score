import { test, expect } from '@playwright/test';

type Widget = { isVisible(): Promise<boolean> };

async function touch(widget: Widget) {
  await widget.isVisible();
}

test('widget helper', async ({ page }) => {
  await page.goto('/dashboard');
  await touch({ isVisible: async () => true });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
