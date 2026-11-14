import { expect, type Page } from '@playwright/test';

// A fixture factory: the helper methods are object-literal members.
export function createEventFixture(page: Page) {
  return {
    openEvents: async () => {
      await page.goto('/events');
    },
    checkTabShown: async () => {
      await expect(page.getByRole('tab', { name: 'Availability' })).toBeVisible();
    },
  };
}
