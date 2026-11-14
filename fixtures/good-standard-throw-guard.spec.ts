import { test, expect } from '@playwright/test';

// Fixture: `if (!x) throw` only fails the test early with a clear message.
// It is a guard, not test logic that branches.
test('opens the created booking', async ({ page }) => {
  await page.goto('/bookings');
  const id = await page.getByTestId('booking-id').textContent();
  if (!id) throw new Error('booking id missing');
  if (id.length > 64) {
    throw new Error('booking id looks wrong');
  }
  await page.goto(`/bookings/${id}`);
  await expect(page.getByRole('heading', { name: 'Booking' })).toBeVisible();
});
