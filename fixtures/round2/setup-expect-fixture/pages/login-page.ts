import type { Page } from '@playwright/test';
export class LoginPage { constructor(private page: Page) {} async login(u: string) { await this.page.getByLabel('User').fill(u); await this.page.getByRole('button').click(); } }
