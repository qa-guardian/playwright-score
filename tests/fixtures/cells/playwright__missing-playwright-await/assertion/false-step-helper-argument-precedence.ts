import { test, expect } from '@playwright/test';

async function inStep(title: string, check: Promise<void>) {
  await test.step(title, async () => {
    await check;
  });
}

test('pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await inStep('pricing heading', expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible());
});
