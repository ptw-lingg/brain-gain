import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent } from './fixtures';

// E2E for draft/published separation (SYS-UPD-07/08/09, traced to SR-170/SR-172 and
// VT-183/VT-185/VT-186): while a draft exists the learner's session still serves the published
// content; a never-published training (version 0) is "in preparation" — visible but not startable;
// and the editor can discard a draft, reverting to the published state. The API-level semantics
// (staging, promotion, gating, byte cleanup, audit) are covered in
// backend/tests/training-drafts.test.mjs.

const PUBLISHED_NAME = `E2E Draft Behind ${Date.now()}`;
const UNPUBLISHED_NAME = `E2E In Preparation ${Date.now()}`;

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let publishedId: string; // published v1 + a differing draft
let unpublishedId: string; // never published (version 0)
let lab: { id: string; name: string; trainingIds: string[] };

test.describe('Trainings — drafts stay invisible to trainees', () => {
  test.beforeAll(async ({ request }) => {
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const adminToken = await tokenFor(request, CREDS.admin);

    // Training 1: published v1, then a content edit staged as a draft.
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: {
        name: PUBLISHED_NAME,
        materials: [{ variants: [{ locale: 'en', label: 'Published guide', url: 'https://example.com/published' }] }],
      },
    });
    expect(created.status()).toBe(201);
    publishedId = (await created.json()).id;
    await publishSilent(request, publishedId, trainerToken);
    const staged = await request.put(`/api/trainings/${publishedId}`, {
      headers: auth(trainerToken),
      data: { materials: [{ variants: [{ locale: 'en', label: 'WIP guide', url: 'https://example.com/wip' }] }] },
    });
    expect(staged.status()).toBe(200);

    // Training 2: created with content but never published — version 0.
    const fresh = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: {
        name: UNPUBLISHED_NAME,
        materials: [{ variants: [{ locale: 'en', label: 'Unfinished', url: 'https://example.com/unfinished' }] }],
      },
    });
    expect(fresh.status()).toBe(201);
    unpublishedId = (await fresh.json()).id;

    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    await request.put(`/api/roles/${lab.id}`, {
      headers: auth(adminToken),
      data: { name: lab.name, trainingIds: [...lab.trainingIds, publishedId, unpublishedId] },
    });
  });

  test.afterAll(async ({ request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
    for (const id of [publishedId, unpublishedId]) {
      if (id) await request.delete(`/api/trainings/${id}`, { headers: auth(adminToken) });
    }
  });

  test("SYS-UPD-07 / SR-170 / VT-183: while a draft exists, the learner's session still serves the published content", async ({ page }) => {
    await login(page, 'member');
    await page.goto(`/session/${publishedId}`);
    await expect(page.getByRole('heading', { name: PUBLISHED_NAME })).toBeVisible();
    await expect(page.getByText('Published guide')).toBeVisible();
    await expect(page.getByText('WIP guide')).toHaveCount(0);
  });

  test('SYS-UPD-08 / SR-170 / VT-185: a never-published training is "in preparation" — visible but not startable', async ({ page }) => {
    await login(page, 'member');
    const card = page.locator('.card', { hasText: UNPUBLISHED_NAME });
    await expect(card).toBeVisible();
    await expect(card).toContainText('In preparation');
    await expect(card.getByRole('button', { name: 'Start' })).toBeDisabled();
    // No version chip while nothing is published.
    await expect(card.getByText(/^v\d+$/)).toHaveCount(0);

    // A deep link cannot bypass the gate: the session page shows the in-preparation notice.
    await page.goto(`/session/${unpublishedId}`);
    await expect(page.getByTestId('session-unpublished')).toBeVisible();
    await expect(page.getByTestId('session-start')).toHaveCount(0);
  });

  test('SYS-UPD-09 / SR-172 / VT-186: the editor discards the draft and the content reverts to the published state', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    // The list flags the unpublished changes; the editor shows the WIP on open.
    const row = page.locator('.card', { hasText: PUBLISHED_NAME });
    await expect(row).toContainText('Draft');
    await row.getByText(PUBLISHED_NAME).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('button', { name: /Learning material/ }).click();
    await expect(editor.getByPlaceholder('https://…').first()).toHaveValue('https://example.com/wip');

    // Discard from the versions dialog — the WIP is gone, the published content stands.
    await editor.getByTestId('manage-updates').click();
    const versions = page.getByTestId('publish-update-dialog');
    await expect(versions).toContainText('Publishing the draft saved');
    await versions.getByTestId('discard-draft').click();
    await expect(page.getByText('Draft discarded')).toBeVisible();
    await expect(versions).toHaveCount(0);
    await page.keyboard.press('Escape'); // close the still-open editor (its local copy is stale now)

    await page.locator('.card', { hasText: PUBLISHED_NAME }).getByText(PUBLISHED_NAME).click();
    const reopened = page.getByRole('dialog');
    await reopened.getByRole('button', { name: /Learning material/ }).click();
    await expect(reopened.getByPlaceholder('https://…').first()).toHaveValue('https://example.com/published');
  });
});
