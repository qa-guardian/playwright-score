import { test } from '@playwright/test';
import { expect } from 'chai';

test('price list', async ({ request }) => {
  const response = await request.get('/api/prices');
  const prices: number[] = await response.json();
  prices.forEach(async (price) => {
    await expect(price).to.be.above(0);
  });
});
