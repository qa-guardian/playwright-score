// Vendored from microsoft/playwright (examples/todomvc/tests/deleting-todos/should-delete-single-todo.spec.ts at 91eeb0cfe92482f18ff8d40d746903ef23c0d8fd), Apache-2.0.
// See fixtures/playwright-official/NOTICE.md.

// spec: specs/basic-operations.plan.md
// seed: tests/seed.spec.ts

import { test, expect } from '../fixtures';

test.describe('Deleting Todos', () => {
  test('should-delete-single-todo', async ({ page }) => {
    // 1. Add a todo 'Task to delete'
    await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Task to delete');
    await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
    await expect(page.getByText('Task to delete')).toBeVisible();
    await expect(page.getByText('1 item left')).toBeVisible();

    // 2. Hover over the todo item
    await page.getByTestId('todo-item').hover();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

    // 3. Click the delete button
    const deleteButton = page.getByRole('button', { name: 'Delete' });
    await deleteButton.click();
    await expect(page.getByText('Task to delete')).not.toBeVisible();
    await expect(page.getByTestId('todo-item')).not.toBeVisible();
  });
});
