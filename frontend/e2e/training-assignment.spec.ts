import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent } from './fixtures';

// E2e specs for training assignment beyond job roles (SYS-TRN-23, traced to SR-197/SR-198/SR-199):
// the editor's Assignment section lets an owning trainer tick "Everyone", roles and org units
// (with the sub-units switch) and the dashboard of a member without matching roles follows suit.
// Validation tests: VT-233 (org unit), VT-234 (everyone), VT-235 (edited on the training).
// Follows frontend/e2e/trainings.spec.ts; unique names per run from Date.now().
const STAMP = Date.now();

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Training assignment: everyone, org units, roles (SYS-TRN-23)', () => {
  test('SYS-TRN-23 / VT-234 (SR-198, SR-199): the owning trainer assigns a training to everyone in the editor; a member without the role sees it', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const name = `E2E Everyone ${STAMP}`;
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: { name: { en: name }, questions: [{ text: { en: 'Q' }, options: [{ en: 'A' }, { en: 'B' }], correctIndices: [0], type: 'single' }] },
    });
    expect(created.status()).toBe(201);
    const trainingId = (await created.json()).id;
    await publishSilent(request, trainingId, trainerToken);

    // A member with NO roles — only an "everyone" rule can reach them.
    const email = `e2e.nobody.${STAMP}@test.local`;
    const member = await request.post('/api/users', {
      headers: auth(adminToken),
      data: { name: 'E2E Nobody', email, password: 'secret123', roleIds: [] },
    });
    expect(member.status()).toBe(201);

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(name, { exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const section = page.getByTestId('assignment-section');
    await expect(section).toContainText('Nobody yet');
    await section.getByRole('button', { name: 'Assignment' }).click();
    await page.getByTestId('assignment-everyone').check();
    await expect(section).toContainText('Everyone');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

    // Reopen: the rule persisted.
    await page.getByText(name, { exact: true }).first().click();
    await expect(page.getByTestId('assignment-everyone')).toBeChecked();

    // The role-less member finds the training on their dashboard.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'secret123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test('SYS-TRN-23 / VT-233 / VT-235 (SR-197, SR-199): org units are added with the sub-units switch, and roles can be ticked from the training', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const units = await (await request.get('/api/org-units', { headers: auth(adminToken) })).json();
    const root = units.find((u: { parentId: string | null }) => u.parentId === null);
    const unitName = `E2E Unit ${STAMP}`;
    const unit = await request.post('/api/org-units', { headers: auth(adminToken), data: { name: unitName, parentId: root.id } });
    expect(unit.status()).toBe(201);
    const unitId = (await unit.json()).id;

    const name = `E2E Unit Training ${STAMP}`;
    const created = await request.post('/api/trainings', { headers: auth(trainerToken), data: { name: { en: name } } });
    const trainingId = (await created.json()).id;

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(name, { exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    const section = page.getByTestId('assignment-section');
    await section.getByRole('button', { name: 'Assignment' }).click();

    // Add the unit: it appears with "incl. sub-units" on by default; switch it off.
    await page.getByTestId('assignment-add-org-unit').selectOption(unitId);
    const row = page.getByTestId('assignment-org-units').locator('div', { hasText: unitName }).first();
    const sub = row.getByRole('checkbox');
    await expect(sub).toBeChecked();
    await sub.uncheck();
    // Tick the seeded role from the training side.
    await page.getByTestId('assignment-roles').getByText('Lab Technician', { exact: true }).click();
    await expect(section).toContainText('1 role · 1 org unit');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

    // Persisted on the server: the assignment entry and the role's trainingIds.
    const stored = await (await request.get(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) })).json();
    expect(stored.assignment).toEqual({ everyone: false, orgUnits: [{ orgUnitId: unitId, includeSubunits: false }] });
    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    const lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    expect(lab.trainingIds).toContain(trainingId);
  });
});
