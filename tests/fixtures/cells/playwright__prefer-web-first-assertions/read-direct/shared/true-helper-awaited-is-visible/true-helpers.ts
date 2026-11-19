import { expect, type Page } from '@playwright/test';

export async function checkHeading(page: Page) {
  expect(await page.getByRole('heading').isVisible()).toBe(true);
}
