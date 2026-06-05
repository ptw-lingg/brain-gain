import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// e2e spec for the HTTPS/TLS Settings panel. Frontend SYS-TLS-07 (Settings TLS card), traced to
// stakeholder SR-111 (admin-managed TLS certificate). Follows the auth.spec.ts pattern.
//
// The hands-on "install a cert" usability flow is documented as a MANUAL test (VT-U10) in
// requirements/manual-tests/tls.md — it needs real cert/key files and a human to confirm the swap.
test.describe('HTTPS / TLS certificate (Settings panel)', () => {
  test('SYS-TLS-07 / SR-111: admin sees the HTTPS/TLS certificate card with active-cert metadata', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    const card = page.locator('.card', { hasText: 'HTTPS / TLS certificate' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Active certificate');

    // A fresh server has no persisted cert metadata yet ("No certificate metadata available.").
    // Regenerating a self-signed cert populates settings.tls, which the panel then renders.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/settings/certificate/self-signed') && r.request().method() === 'POST',
      ),
      card.getByRole('button', { name: /Regenerate self-signed/i }).click(),
    ]);

    // The active-certificate panel now shows non-secret metadata.
    await expect(card).toContainText('source:');
    await expect(card).toContainText('fingerprint:');
    await expect(card).toContainText('subject:');
    await expect(card).toContainText('issuer:');
    await expect(card).toContainText('valid from:');
    await expect(card).toContainText('valid to:');
  });

  test('SYS-TLS-07 / SR-111: the panel exposes cert/key/chain file pickers and install controls', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    const card = page.locator('.card', { hasText: 'HTTPS / TLS certificate' });
    await expect(card).toContainText('Certificate (PEM)');
    await expect(card).toContainText('Private key (PEM)');
    await expect(card).toContainText('Chain / intermediates (PEM, optional)');

    // Three file inputs (cert, key, chain) and the install / regenerate buttons are present.
    await expect(card.locator('input[type="file"]')).toHaveCount(3);
    await expect(card.getByRole('button', { name: /Install certificate/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /Regenerate self-signed/i })).toBeVisible();
  });

  test('SYS-TLS-07 / SR-111 / SR-105: the panel states the private key is never sent to the browser', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    const card = page.locator('.card', { hasText: 'HTTPS / TLS certificate' });
    // SR-105 / SYS-TLS-04: the UI reassures that the key stays on the server.
    await expect(card).toContainText('never sent back to the browser');
  });
});
