import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E spec for the UI / UX system area (SYS-UI-04 layout+navigation, SYS-UI-06 loading+toasts),
// derived from stakeholder SR-093 (responsive & accessible) and SR-094 (clear operation feedback).
// Mechanically observable end-to-end behaviour only — visual/aesthetic (SR-090/091/092),
// responsiveness across breakpoints, and accessibility (VT-A01..A04) are covered as manual
// procedures in requirements/manual-tests/ui.md.
//
// Implementation under test:
//   frontend/src/components/AppSidebar.vue  (the <aside> nav + role-gated links)
//   frontend/src/components/AppLayout.vue    (sidebar + scrollable content shell)
//   frontend/src/stores/toast.ts             (global toast store; push/success/error)
//   frontend/src/App.vue                     (global toast host renders each toast message)
//   frontend/src/pages/SettingsPage.vue      (save() -> PUT /settings -> toast.success(...))
test.describe('UI / UX — layout, navigation & operation feedback', () => {
  // SYS-UI-06 / SR-094 / VT-U09: a save action surfaces a success toast.
  // SettingsPage.save() PUTs /settings then calls toast.success('Pass threshold updated for all
  // trainings'); App.vue renders that message in the global toast host.
  test('SYS-UI-06 / VT-U09 / SR-094: a successful save shows a success toast', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    // Wait for the settings form to finish loading (the Save button replaces the loading skeleton).
    const saveButton = page.getByRole('button', { name: /Save changes/i });
    await expect(saveButton).toBeVisible();

    await saveButton.click();

    // The global toast host (App.vue) surfaces the success message text.
    await expect(page.getByText('Pass threshold updated for all trainings')).toBeVisible();
  });

  // SYS-UI-04 / SR-093: the persistent sidebar nav is present for an authenticated user.
  test('SYS-UI-04 / SR-093: the sidebar navigation is present after sign-in', async ({ page }) => {
    await login(page, 'admin');
    const aside = page.locator('aside');
    await expect(aside).toBeVisible();
    // Brand/logo lives in the sidebar.
    await expect(aside.getByLabel('BrainGain logo')).toBeVisible();
    // Member entry point is always present.
    await expect(aside).toContainText('My Trainings');
  });

  // SYS-UI-04 / SR-093: key navigation works — clicking nav links routes to the right pages.
  test('SYS-UI-04 / SR-093: key navigation between admin pages works', async ({ page }) => {
    await login(page, 'admin');
    const aside = page.locator('aside');

    // Use exact names so "Trainings" does not also match "My Trainings".
    await aside.getByRole('link', { name: 'Trainings', exact: true }).click();
    await expect(page).toHaveURL(/\/trainings/);

    await aside.getByRole('link', { name: 'Trainees', exact: true }).click();
    await expect(page).toHaveURL(/\/trainees/);

    await aside.getByRole('link', { name: 'Job Roles', exact: true }).click();
    await expect(page).toHaveURL(/\/roles/);

    await aside.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page).toHaveURL(/\/users/);

    await aside.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);

    await aside.getByRole('link', { name: 'My Trainings', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // SYS-UI-04 / SR-004: the navigation is role-gated — a member sees only their own entry point.
  test('SYS-UI-04 / SR-004: a member sees only the member navigation', async ({ page }) => {
    await login(page, 'member');
    const aside = page.locator('aside');
    await expect(aside).toContainText('My Trainings');
    await expect(aside).not.toContainText('Users');
    await expect(aside).not.toContainText('Settings');
    await expect(aside).not.toContainText('Job Roles');
  });
});
