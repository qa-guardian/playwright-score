import { expect } from '@playwright/test';
import { notAFactory } from './fixtures';

function unknownMaker(cfg: string) {
  return (title: string, fn: () => Promise<void>) => fn();
}

unknownMaker('x')('not a test', async () => {
  expect(1).toBe(1);
});

notAFactory()('also not a test', async () => {
  expect(2).toBe(2);
});
