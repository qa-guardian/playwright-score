import { test, expect } from '@playwright/test';

test('main region', async ({ page }) => expect(page.getByRole('main')));
