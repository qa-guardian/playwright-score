import { expect, type Page } from '@playwright/test';

export async function checkUrl(page: Page) {
  expect(page.url()).toBe('https://shop.example/cart');
}
