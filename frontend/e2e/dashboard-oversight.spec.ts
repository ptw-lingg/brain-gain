import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2e specs for the Dashboard & Trainee Oversight requirement area.
//   SYS-DSH-01 (derivedFrom SR-060 dashboard of required trainings + status, SR-061 empty state)
//             — VT-060 "dashboard shows required trainings + status", VT-061 "friendly empty state".
//   SYS-OVS-02 (derivedFrom SR-070 grouped oversight, SR-071 filter due + email reminders)
//             — VT-070 "trainee oversight grouped by training", VT-071 "filter due & email reminders".
//
// Backed by DashboardPage.vue / TrainingCard.vue and TraineesPage.vue. The seeded member
// (user@braingain.app) holds the "Lab Technician" role requiring 2 trainings; the trainer owns both.
// Follows the reference pattern in auth.spec.ts (login() then page.goto('/path')).

test.describe('Learner dashboard (SYS-DSH-01)', () => {
  test('SYS-DSH-01 / VT-060: a member sees their 2 assigned training cards with a due pill + Start', async ({ page }) => {
    await login(page, 'member');
    await expect(page).toHaveURL(/\/dashboard/);

    // The seeded Lab Technician role requires exactly these two trainings.
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quality Management Intro' })).toBeVisible();

    // Each card carries a due-status pill (never-taken renders "Due now") and a Start action.
    const startButtons = page.getByRole('button', { name: /Start/ });
    await expect(startButtons).toHaveCount(2);
    await expect(page.getByText('Due now').first()).toBeVisible();

    // The header summary reflects the assigned/due counts.
    await expect(page.locator('main')).toContainText('2 assigned');
  });

  test('SYS-DSH-01 / VT-060: Start on a card opens that training session', async ({ page }) => {
    await login(page, 'member');
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page).toHaveURL(/\/session\//);
  });

  test('SYS-DSH-01 / VT-061: an admin with no assigned trainings sees the friendly empty state', async ({ page }) => {
    // The seeded admin holds no job roles → /trainings/mine is empty → empty state, not an error.
    await login(page, 'admin');
    await page.goto('/dashboard');
    await expect(page.getByText('No trainings yet. Ask your admin to assign you a role.')).toBeVisible();
    // No training cards / Start actions are rendered in the empty state.
    await expect(page.getByRole('button', { name: /Start/ })).toHaveCount(0);
  });
});

test.describe('Trainee oversight (SYS-OVS-02)', () => {
  test('SYS-OVS-02 / VT-070: a trainer sees per-training groups listing the assigned trainees', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainees');

    // Groups are titled by the (owned) trainings, in admin-defined order.
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
    await expect(page.getByText('Quality Management Intro')).toBeVisible();

    // The seeded member appears as a trainee under the groups (name + email shown).
    await expect(page.getByText('Uma User').first()).toBeVisible();
    await expect(page.getByText('user@braingain.app').first()).toBeVisible();
  });

  test('SYS-OVS-02 / VT-070: an admin sees the same grouped oversight for all trainings', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainees');
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
    await expect(page.getByText('Quality Management Intro')).toBeVisible();
    await expect(page.getByText('Uma User').first()).toBeVisible();
  });

  test('SYS-OVS-02 / VT-071: the "only due/overdue" filter is on by default and toggles trainee visibility', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainees');

    const onlyDue = page.getByRole('checkbox');
    // Default: only actionable (never/due/overdue) trainees are shown. The seeded member is never-taken,
    // so they are visible under the default filter.
    await expect(onlyDue).toBeChecked();
    await expect(page.getByText('Uma User').first()).toBeVisible();

    // Turning the filter OFF shows everyone assigned (the member is still present).
    await onlyDue.uncheck();
    await expect(onlyDue).not.toBeChecked();
    await expect(page.getByText('Uma User').first()).toBeVisible();
  });

  test('SYS-OVS-02 / VT-071: per-group "Email trainees" reaches the mail service (Settings hint while SMTP is unset)', async ({ page }) => {
    // Copy-to-clipboard was superseded by sending email directly (SR-097). On seeded data SMTP is
    // not configured, so the action must surface a clear pointer to Settings instead of failing silently.
    await login(page, 'trainer');
    await page.goto('/trainees');

    await page.getByRole('button', { name: 'Email trainees' }).first().click();
    await expect(
      page.getByText("Email isn't set up yet. Configure the SMTP server in Settings."),
    ).toBeVisible();
  });

  test('SYS-OVS-02 / VT-070: a plain member has no Trainees navigation and is kept off /trainees', async ({ page }) => {
    await login(page, 'member');
    await expect(page.locator('aside')).not.toContainText('Trainees');
    // Direct navigation is not granted to a member (router guard sends them back to the dashboard).
    await page.goto('/trainees');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
