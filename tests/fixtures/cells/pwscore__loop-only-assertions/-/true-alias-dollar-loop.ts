import { test, expect } from '@playwright/test';

test('every gallery tile has a caption', async ({ page }) => {
  const view = page;
  await view.goto('/gallery');
  const tiles = await view.$$('.gallery-tile');
  for (const tile of tiles) {
    expect(await tile.getAttribute('data-caption')).toMatch(/\w/);
  }
});
