import { test, expect } from '@playwright/test';
import assert from 'node:assert';

test('throws after logging', async ({ page }) => {
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    console.error('banner missing');
    throw e;
  }
});

test('asserts in catch', async ({ page }) => {
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    expect(String(e)).toBe('');
  }
});

test('test.fail in catch', async ({ page }) => {
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    test.fail(true, 'banner');
  }
});

test('assert.fail in catch', async ({ page }) => {
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    assert.fail('banner');
  }
});
