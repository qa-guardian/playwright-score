import { test, expect } from '@playwright/test';

test.skip('shows the name', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByTestId('name')).toHaveText('Sam');
});

test.fixme('edits the name', async ({ page }) => {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Name')).toBeEditable();
});

test.describe.skip('avatar', () => {
  test('uploads a picture', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('img', { name: 'Avatar' })).toBeVisible();
  });
});

test('shows the email', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByTestId('email')).toBeVisible();
});
