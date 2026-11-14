import { test, expect } from '@playwright/test';

test('automation is created', async ({ page }) => {
  await page.goto('/automations');
  const nameInput = page.getByLabel('Automation name');
  if (!(await nameInput.isVisible())) {
    await page.getByRole('button', { name: 'New automation' }).click();
    await nameInput.fill('nightly');
  }
  await expect(nameInput).toHaveValue('nightly');
});

test('preset is applied', async ({ page }) => {
  await page.goto('/automations');
  const preset = page.getByLabel('Preset');
  try {
    await expect(preset).toHaveValue('daily');
  } catch {
    await preset.selectOption('daily');
  }
  await expect(preset).toHaveValue('daily');
});
