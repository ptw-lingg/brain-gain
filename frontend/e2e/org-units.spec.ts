import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the Org Units admin page (UI surface of SYS-ORG-01/02, traced to SR-124 / VT-125): the
// admin-only guard, creating a unit, and re-parenting it in the tree editor. Hierarchy integrity,
// membership migration and bulk member moves are covered API-side in backend/tests/org-units.test.mjs.

test.describe('Org Units page', () => {
  test('SYS-AC-04 / SR-004: /org-units is admin-only — a trainer is bounced to the dashboard', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/org-units');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('SYS-ORG-01 / SYS-ORG-02 / SR-124 / VT-125: an admin creates a unit and re-parents it in the tree', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/org-units');
    await expect(page.getByRole('heading', { name: 'Org Units' })).toBeVisible();
    await expect(page.getByText('company')).toBeVisible(); // the root unit carries the company badge

    // Create two sibling units under the root.
    const stamp = Date.now();
    const unitA = `E2E Parent ${stamp}`;
    const unitB = `E2E Child ${stamp}`;
    for (const name of [unitA, unitB]) {
      await page.getByRole('button', { name: 'Add Unit' }).click();
      await page.getByPlaceholder('e.g. Research & Development').fill(name);
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByText(name)).toBeVisible();
    }

    // Re-parent B under A via the inline unit editor.
    await page.getByText(unitB).click();
    await page.getByLabel('Parent unit').selectOption({ label: unitA });
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // The change persists: reload, reopen B — the parent select shows A.
    await page.reload();
    await page.getByText(unitB).click();
    await expect(page.getByLabel('Parent unit')).toContainText(unitA);
    const selected = await page.getByLabel('Parent unit').inputValue();
    const optionLabel = await page.getByLabel('Parent unit').locator(`option[value="${selected}"]`).textContent();
    expect(optionLabel?.trim()).toBe(unitA);
  });
});
