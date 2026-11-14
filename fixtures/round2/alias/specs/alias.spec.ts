import { test } from '@fx/base';
test('alias a11y', async ({ page, a11y }) => { await page.goto('/'); await a11y(); });
