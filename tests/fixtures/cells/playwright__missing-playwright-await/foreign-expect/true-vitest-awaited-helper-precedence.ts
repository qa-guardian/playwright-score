import { expect, test } from 'vitest';

async function track(check: unknown): Promise<void> {
  await check;
}

// A component test: this library's DOM matcher is passed to an awaited helper.
test('banner is shown', async () => {
  const banner = document.querySelector('#banner');
  await track(expect(banner).toBeVisible());
});
