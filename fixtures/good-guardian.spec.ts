import { test, expect } from '@playwright/test';

test.describe('Create project', () => {
  test('user can create a project', async ({ page }) => {
    const uid = crypto.randomUUID().split('-')[0];

    await test.step('Navigate', async () => {
      await page.goto('/projects');
    });

    await test.step('Pre-flight UI audit', async () => {
      await expect.soft(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
      await expect.soft(page.getByRole('button', { name: 'New project' })).toBeVisible({
        timeout: 2000,
      });
    });

    await test.step('Create project', async () => {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByLabel('Name').fill(`project-${uid}`);
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByText(`project-${uid}`)).toBeVisible({ timeout: 20000 });
    });
  });
});
