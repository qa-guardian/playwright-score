import { test, expect } from '@playwright/test';

// Fixture: hard sleeps where they hurt: directly in a test body, in a
// spec-file hook, and in a loop that lives inside a test callback.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

test('sleeps in the body', async ({ page }) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('sleeps in a loop in the body', async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('uses a bare sleep helper', async ({ page }) => {
  await sleep(1000);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
