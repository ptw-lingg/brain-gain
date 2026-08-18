import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for the editor's reorder buttons (SYS-TRN-18, traced to SR-174 / VT-190): materials,
// questions and answer options move with up/down buttons; the answer key follows its option when
// options move; and the new order survives save + reopen (staged as the draft). The server-side
// order persistence and the promoted learner payload are covered API-side in
// backend/tests/training-reorder.test.mjs.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test('SYS-TRN-18 / SR-174 / VT-190: the editor reorders materials, questions and options — the answer key follows and the order persists', async ({ page, request }) => {
  const trainerToken = await tokenFor(request, CREDS.trainer);
  const name = `E2E Reorder ${Date.now()}`;
  let trainingId: string | null = null;
  try {
    // Arrange: two materials, two questions; the second question's correct answer is "Opt C" (index 2).
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: {
        name,
        materials: [
          { variants: [{ locale: 'en', label: 'First doc', url: 'https://example.com/1' }] },
          { variants: [{ locale: 'en', label: 'Second doc', url: 'https://example.com/2' }] },
        ],
        questions: [
          { text: 'Q-one', options: ['a', 'b'], correctIndices: [0], type: 'single' },
          { text: 'Q-two', options: ['Opt A', 'Opt B', 'Opt C'], correctIndices: [2], type: 'single' },
        ],
      },
    });
    expect(created.status()).toBe(201);
    trainingId = (await created.json()).id;

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(name).click();
    const editor = page.getByRole('dialog');

    // Materials: move the first one down — the panels swap.
    await editor.getByRole('button', { name: /Learning material/ }).click();
    const materialTitles = editor.locator('[data-testid="move-material-up"]').locator('../..');
    await expect(materialTitles.nth(0)).toContainText('First doc');
    await editor.getByTestId('move-material-down').nth(0).click();
    await expect(materialTitles.nth(0)).toContainText('Second doc');
    await expect(editor.getByTestId('move-material-down').nth(1)).toBeDisabled();

    // Questions: move the second one up — the row titles renumber and swap.
    await editor.getByRole('button', { name: /Quiz questions/ }).click();
    await expect(editor.getByRole('button', { name: /1\. Q-one/ })).toBeVisible();
    await editor.getByTestId('move-question-up').nth(1).click();
    await expect(editor.getByRole('button', { name: /1\. Q-two/ })).toBeVisible();
    await expect(editor.getByRole('button', { name: /2\. Q-one/ })).toBeVisible();
    await expect(editor.getByTestId('move-question-up').nth(0)).toBeDisabled();

    // Options: inside Q-two (now first), move the correct "Opt C" up — the key radio follows it.
    await editor.getByRole('button', { name: /1\. Q-two/ }).click();
    const key = editor.locator('input[name="qkey-0"]');
    await expect(key.nth(2)).toBeChecked();
    await editor.getByTestId('move-option-up').nth(2).click();
    await expect(key.nth(1)).toBeChecked();
    await expect(editor.getByPlaceholder('Option 2').first()).toHaveValue('Opt C');
    await expect(editor.getByPlaceholder('Option 3').first()).toHaveValue('Opt B');

    // Save (a content edit → the publish step is offered; keep it as a draft) and reopen: the new
    // order round-tripped through the server.
    await editor.getByRole('button', { name: 'Save' }).click();
    const publish = page.getByTestId('publish-update-dialog');
    await expect(publish).toBeVisible();
    await publish.getByTestId('publish-update-skip').click();

    await page.getByText(name).click();
    const reopened = page.getByRole('dialog');
    await reopened.getByRole('button', { name: /Learning material/ }).click();
    await expect(reopened.locator('[data-testid="move-material-up"]').locator('../..').nth(0)).toContainText('Second doc');
    await reopened.getByRole('button', { name: /Quiz questions/ }).click();
    await expect(reopened.getByRole('button', { name: /1\. Q-two/ })).toBeVisible();
    await reopened.getByRole('button', { name: /1\. Q-two/ }).click();
    await expect(reopened.locator('input[name="qkey-0"]').nth(1)).toBeChecked();
    await expect(reopened.getByPlaceholder('Option 2').first()).toHaveValue('Opt C');
  } finally {
    if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
  }
});
