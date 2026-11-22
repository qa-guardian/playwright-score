import { Page as PwPage } from '@playwright/test';

export async function open(targetPage: PwPage) {
  await targetPage.waitForNavigation();
}
