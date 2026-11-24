import { test } from '@playwright/test';

test('submits the newsletter form', async ({ page }) => {
  const email = page.getByLabel('Email address');
  const submit = page.getByRole('button', { name: 'Subscribe' });
  await page.goto('/newsletter');
  await email.fill('reader@example.test');
  await submit.click();
});
