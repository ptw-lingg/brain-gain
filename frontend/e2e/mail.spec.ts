import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for sending email from the system (SYS-MAIL-02), traced to SR-097 and validated by VT-133.
// On the seeded data SMTP is unconfigured, so emailing trainees must surface a clear hint to set it
// up in Settings (the POST /api/mail/send call returns 503).
//
// Implementation under test:
//   frontend/src/pages/TraineesPage.vue   (emailGroup / emailAll → POST /api/mail/send)
//   frontend/src/pages/SettingsPage.vue    (SMTP configuration card)
test.describe('Email — send from the system', () => {
  test('SYS-MAIL-02 / VT-133 / SR-097: emailing trainees prompts to configure SMTP when unset', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainees');

    await page.getByRole('button', { name: 'Email everyone' }).click();
    await expect(
      page.getByText("Email isn't set up yet. Configure the SMTP server in Settings."),
    ).toBeVisible();
  });

  test('SYS-MAIL-01 / SR-097: Settings exposes the SMTP configuration fields', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');
    await expect(page.getByText('Outbound email (SMTP)')).toBeVisible();
    await expect(page.getByPlaceholder('smtp.example.com')).toBeVisible();
  });
});
