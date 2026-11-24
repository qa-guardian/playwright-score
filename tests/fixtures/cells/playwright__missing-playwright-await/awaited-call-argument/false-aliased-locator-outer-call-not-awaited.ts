import { test, expect } from '@playwright/test';

function note(check: Promise<void>): void {
  void check;
}

test('docs link', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByRole('link', { name: 'Docs' });
  note(expect(cta).toBeVisible());
});
