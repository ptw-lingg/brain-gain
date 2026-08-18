import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent } from './fixtures';

// E2E for the completion signature (SYS-SES-12, traced to SR-173 / VT-188): completing a training
// is gated by an identity re-confirmation — a wrong password is refused and the learner stays where
// they were, the correct one signs the completion, and the audit trail shows the method next to the
// completion. The verification rules themselves (binding to the acting account, impersonation,
// Microsoft path, freshness) are covered API-side in backend/tests/completion-signature.test.mjs.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test('SYS-SES-12 / SR-173 / VT-188: a wrong password is refused, the correct one signs the completion, and the audit shows the method', async ({ page, request }) => {
  const adminToken = await tokenFor(request, CREDS.admin);
  const name = `E2E Signature ${Date.now()}`;
  let trainingId: string | null = null;
  let lab: { id: string; name: string; trainingIds: string[] } | null = null;
  try {
    // Arrange: a published, material-only training (completed through the signed confirmation).
    const created = await request.post('/api/trainings', {
      headers: auth(adminToken),
      data: {
        name,
        materials: [{ variants: [{ locale: 'en', label: 'Read me', url: 'https://example.com/sign' }] }],
        questions: [],
      },
    });
    expect(created.status()).toBe(201);
    trainingId = (await created.json()).id;
    await publishSilent(request, trainingId!, adminToken);
    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    await request.put(`/api/roles/${lab!.id}`, {
      headers: auth(adminToken),
      data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
    });

    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('session-start').click();
    const dialog = page.getByTestId('confirm-materials-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(CREDS.member.email, { ignoreCase: true });

    // A wrong password is refused: the error shows and the learner stays in the dialog to retry.
    await dialog.getByTestId('signature-password').fill('definitely-wrong');
    await page.getByTestId('confirm-materials-ok').click();
    await expect(page.getByText(/Identity confirmation failed/)).toBeVisible();
    await expect(dialog).toBeVisible();

    // The correct password signs and completes the training.
    await dialog.getByTestId('signature-password').fill(CREDS.member.password);
    await page.getByTestId('confirm-materials-ok').click();
    await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible();

    // The audit trail records the completion WITH the signature method.
    await page.context().clearCookies();
    await login(page, 'admin');
    await page.goto('/audit');
    await page.getByTestId('audit-filter-action').selectOption('training-completed');
    const row = page.getByTestId('audit-row-training-completed').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('signed: password');
  } finally {
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
    if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(adminToken) });
  }
});
