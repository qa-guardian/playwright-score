import { expect, type Page } from '@playwright/test';

export async function checkNames(page: Page) {
  const names = ['Tea', 'Milk'];
  names.forEach(async (name) => {
    await expect(page.getByText(name)).toBeVisible();
  });
}
