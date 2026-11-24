import type { Page } from '@playwright/test';
import { fake } from './runner';

async function open(adminPage: Page) {
  await adminPage.waitForSelector('#orders-table');
}

void open(fake as any);
