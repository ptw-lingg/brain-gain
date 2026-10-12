import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for administering pending activations on the Users page (SYS-USR-05, traced to SR-193 / VT-229):
// the pending badge, the dialog's activation panel, handing out a NEW link (the old one dies) and
// enabling an account directly. Expiry, emailing and the API guards are covered in
// backend/tests/user-activation.test.mjs. SMTP is unconfigured on the seeded data.

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: CREDS.admin });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}

/** Import one pending account through the API; returns its first activation token. */
async function importPending(request: APIRequestContext, name: string, email: string): Promise<string> {
  const res = await request.post('/api/users/import', {
    headers: { Authorization: `Bearer ${await adminToken(request)}` },
    data: { commit: true, rows: [{ name, email, roles: ['Lab Technician'] }] },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).rows[0].activationToken;
}

test.describe('Users — pending activation', () => {
  test('SYS-USR-05 / SYS-USR-04 / VT-229 (SR-193): a pending account is badged; the admin hands out a new link from the dialog and the old link stops working', async ({ page, request }) => {
    const email = `e2e.pending.${Date.now()}@test.local`;
    const oldToken = await importPending(request, 'Penny Pending', email);

    await login(page, 'admin');
    await page.goto('/users');
    const row = page.locator('tr', { hasText: email });
    await expect(row.getByTestId('user-pending-badge')).toHaveText(/pending activation/);

    await row.click();
    const panel = page.getByTestId('pending-panel');
    await expect(panel).toContainText('Pending activation');
    await expect(panel).toContainText('valid until');
    // No SMTP on the seeded data: emailing is offered but disabled, with the reason.
    await expect(panel.getByTestId('pending-send-link')).toBeDisabled();
    await expect(panel).toContainText('Email is not configured');

    await panel.getByTestId('pending-copy-link').click();
    const linkInput = panel.getByTestId('pending-link');
    await expect(linkInput).toHaveValue(/\/activate\?token=.+/);
    const url = await linkInput.inputValue();
    expect(url).not.toContain(oldToken);

    const oldPeek = await request.get(`/api/auth/activate/${oldToken}`);
    expect(oldPeek.status(), 'the previous link no longer resolves').toBe(404);

    // The new link opens the activation page for this account.
    await page.goto(url.slice(url.indexOf('/activate')));
    await expect(page.getByRole('heading', { name: 'Activate your account' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveValue(email);
  });

  test('SYS-USR-05 / SYS-USR-04 / VT-229 (SR-193): the admin activates a pending account with a password, the badge disappears and the user can sign in', async ({ page, request }) => {
    const email = `e2e.activate.${Date.now()}@test.local`;
    await importPending(request, 'Andy Activate', email);

    await login(page, 'admin');
    await page.goto('/users');
    const row = page.locator('tr', { hasText: email });
    await row.click();
    const panel = page.getByTestId('pending-panel');
    // Without a password (and no Microsoft sign-in) the account cannot be activated yet.
    await expect(panel.getByTestId('pending-activate')).toBeDisabled();
    await expect(panel.getByTestId('pending-activate-hint')).toContainText('Enter a password');

    await page.getByLabel('New password (leave blank to keep)').fill('adminset123');
    await expect(panel.getByTestId('pending-activate-hint')).toContainText('uses the password entered above');
    await panel.getByTestId('pending-activate').click();

    await expect(page.getByText('Account activated')).toBeVisible();
    await expect(page.getByTestId('pending-panel')).toHaveCount(0);
    await expect(row.getByTestId('user-pending-badge')).toHaveCount(0);

    const signIn = await request.post('/api/auth/login', { data: { email, password: 'adminset123' } });
    expect(signIn.status(), 'the user signs in with the password the admin set').toBe(200);
  });
});
