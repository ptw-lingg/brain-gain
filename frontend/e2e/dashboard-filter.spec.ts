import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for the dashboard due-only filter (SYS-DSH-02, traced to SR-156 / VT-163): "Only show due
// trainings" is checked by default so the dashboard reads as a work list; unchecking it reveals the
// up-to-date trainings too. State created via the API is restored in `finally`.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test('SYS-DSH-02 / SR-156 / VT-163: the dashboard shows only due trainings by default; unchecking reveals up-to-date ones', async ({ page, request }) => {
  const adminToken = await tokenFor(request, CREDS.admin);
  const trainerToken = await tokenFor(request, CREDS.trainer);
  const memberToken = await tokenFor(request, CREDS.member);
  const name = `E2E up-to-date ${Date.now()}`;
  let trainingId: string | null = null;
  let lab: { id: string; name: string; trainingIds: string[] } | null = null;
  try {
    // Arrange an UP-TO-DATE training: create, assign, and let the member pass it via the API.
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: {
        name,
        questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
      },
    });
    expect(created.status()).toBe(201);
    trainingId = (await created.json()).id;

    const roles = await request.get('/api/roles', { headers: auth(adminToken) });
    lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
    await request.put(`/api/roles/${lab!.id}`, {
      headers: auth(adminToken),
      data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
    });
    const graded = await request.post('/api/sessions/grade', {
      headers: auth(memberToken),
      data: { trainingId, answers: [[0]] },
    });
    expect((await graded.json()).passed).toBeTruthy();

    // Default: the filter is checked and the up-to-date training is hidden; due ones show.
    // The header also sums the due work: the two seeded due trainings are 120 + 180 minutes.
    await login(page, 'member');
    await expect(page.getByText(/2 due now · 5 h/)).toBeVisible();
    const filter = page.getByRole('checkbox', { name: 'Only show due trainings' });
    await expect(filter).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await expect(page.getByRole('heading', { name })).toHaveCount(0);

    // Unchecking reveals it, marked with its next due date (the up-to-date label).
    await filter.uncheck();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText(/Next due/)).toBeVisible();
  } finally {
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
    if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
  }
});
