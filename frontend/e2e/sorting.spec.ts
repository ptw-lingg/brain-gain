import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for SYS-UI-08 (entity lists/dropdowns sorted by name), traced to SR-096 and validated by
// VT-U13. Lists must be in a sensible, stable order so an entry is fast to find.
//
// Implementation under test:
//   frontend/src/pages/UsersPage.vue  (users + org-unit dropdown sorted by name in load())
test.describe('Lists — sorting', () => {
  test('SYS-UI-08 / VT-U13 / SR-096: the users list is in alphabetical order by name', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');

    // The first column of the users table is the name; it must be in ascending alphabetical order.
    const names = await page.locator('tbody tr td:first-child').allInnerTexts();
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
