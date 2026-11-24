import dayjs from 'dayjs';
import { test } from '@playwright/test';

test('books a slot for tomorrow', async ({ page }) => {
  const day = dayjs().add(1, 'day').format('YYYY-MM-DD');
  await page.goto('/booking');
  await page.getByLabel('Date').fill(day);
  await page.getByRole('button', { name: 'Book' }).click();
});
