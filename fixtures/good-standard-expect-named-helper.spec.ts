import { test, expect, type Locator } from '@playwright/test';

// Fixture: a helper whose name ends in "Expect" is an ordinary function,
// not an expect() call missing its matcher.
async function clickSortableHeaderAndExpect(header: Locator, direction: 'ascending' | 'descending') {
  await header.click();
  await expect(header).toHaveAttribute('aria-sort', direction);
}

test('sorts the table', async ({ page }) => {
  await page.goto('/table');
  await clickSortableHeaderAndExpect(page.getByRole('columnheader', { name: 'name' }), 'ascending');
});
