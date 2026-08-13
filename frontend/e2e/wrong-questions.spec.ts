import { test, expect } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for the reveal-wrong-questions option (SYS-SET-04 toggle in Settings, SYS-SES-07 on the result
// screen; traced to SR-151 / VT-153). Default-off behavior, exact indices and the passed-attempt
// exclusion are covered API-side in backend/tests/wrong-questions.test.mjs; here we prove the admin
// can see the toggle and a failing learner actually sees which questions were wrong — and only those.

test.describe('Failed test — wrongly answered questions', () => {
  test('SYS-SET-04 / SR-151 / VT-153: the settings page offers the reveal toggle, off by default', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');
    const toggle = page.getByRole('checkbox', { name: /Show wrongly answered questions/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test('SYS-SES-07 / SR-151 / VT-153: a failing learner sees which questions were wrong — and only those', async ({ page, request }) => {
    // Arrange through the API: enable the option, create a two-question training, assign it to the
    // seeded member's role.
    const adminToken = (await (await request.post('/api/auth/login', { data: CREDS.admin })).json()).token;
    const trainerToken = (await (await request.post('/api/auth/login', { data: CREDS.trainer })).json()).token;
    const enable = await request.put('/api/settings', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { revealWrongQuestions: true },
    });
    expect(enable.ok()).toBeTruthy();

    const created = await request.post('/api/trainings', {
      headers: { Authorization: `Bearer ${trainerToken}` },
      data: {
        name: `E2E Wrong questions ${Date.now()}`,
        category: 'Test',
        durationMinutes: 60,
        questions: [
          { text: 'Will be answered wrong', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
          { text: 'Will be answered right', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const training = await created.json();

    const roles = await request.get('/api/roles', { headers: { Authorization: `Bearer ${adminToken}` } });
    const lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
    const assigned = await request.put(`/api/roles/${lab.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: lab.name, trainingIds: [...lab.trainingIds, training.id] },
    });
    expect(assigned.ok()).toBeTruthy();

    try {
      // Fail the test: first question wrong, second right → 1/2 misses the 80% threshold.
      await login(page, 'member');
      await page.goto(`/session/${training.id}`);
      await page.getByRole('button', { name: 'Start test' }).click();
      await page.locator('input[name="q-0"]').nth(1).check(); // 'wrong'
      await page.locator('input[name="q-1"]').nth(0).check(); // 'right'
      await page.getByRole('button', { name: 'Submit test' }).click();

      // The failed result names the wrongly answered question — and only that one.
      await expect(page.getByRole('heading', { name: 'Not passed' })).toBeVisible();
      const panel = page.getByText('Answered incorrectly').locator('..');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Will be answered wrong');
      await expect(panel).not.toContainText('Will be answered right');
    } finally {
      // The specs share one seeded server — restore the option and the role for later specs.
      await request.put('/api/settings', {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { revealWrongQuestions: false },
      });
      await request.put(`/api/roles/${lab.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
  });
});
