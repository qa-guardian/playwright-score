import { test, expect } from '@playwright/test';

// Hand-written "gold" fixture (2.0.0 acceptance bar, see CHANGELOG.md):
// every dimension clean on purpose, so 100 is a reachable, verified
// number, not just a theoretical ceiling. tests/official-examples.test.ts
// asserts this scores exactly 100 under `standard`.

test.describe('checkout', () => {
  test('adds an item to the cart and shows the updated total', async ({ page }) => {
    await page.goto('/catalog');

    await page.getByRole('button', { name: 'Add to cart' }).click();

    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await expect(page.getByRole('status', { name: 'Cart total' })).toHaveText('$19.99');
  });

  test('shows a validation error for an empty shipping address', async ({ page }) => {
    await page.goto('/checkout');

    await page.getByLabel('Full name').fill('Ada Lovelace');
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page.getByText('Shipping address is required')).toBeVisible();
  });
});
