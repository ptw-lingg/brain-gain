import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for SYS-UI-07 (shared ListControls: per-list search + expand/collapse-all), derived from
// stakeholder SR-095 and validated by VT-U12. The search box appears on every list; the
// expand-all/collapse-all button appears only on lists whose entries are individually expandable
// (Trainees, My Team) — never on lists like Users/Trainings that have no per-entry disclosure.
//
// Implementation under test:
//   frontend/src/components/ListControls.vue   (search box + optional expand/collapse-all button)
//   frontend/src/utils/listFilter.ts            (matchesQuery — case-insensitive visible-text match)
//   frontend/src/pages/TrainingsPage.vue        (search only)
//   frontend/src/pages/TraineesPage.vue         (search + expand/collapse-all over the group rows)
test.describe('Lists — search & expand/collapse', () => {
  // SYS-UI-07 / VT-U12 / SR-095: typing in the search box filters the list to entries whose visible
  // text matches; a non-matching query surfaces the "no matches" state. A list with non-expandable
  // entries (Trainings) shows no expand/collapse-all button.
  test('SYS-UI-07 / VT-U12 / SR-095: the list search box filters entries by visible text', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainings');

    // Both seeded trainings are listed initially.
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
    await expect(page.getByText('Quality Management Intro')).toBeVisible();

    // Trainings entries are not individually expandable, so there is no expand/collapse-all button.
    await expect(page.getByRole('button', { name: 'Expand all' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse all' })).toHaveCount(0);

    // Searching narrows the list to matching entries (case-insensitive).
    const search = page.getByRole('searchbox');
    await search.fill('quality');
    await expect(page.getByText('Quality Management Intro')).toBeVisible();
    await expect(page.getByText('Laboratory Safety Basics')).toBeHidden();

    // A query that matches nothing shows the empty "no matches" state.
    await search.fill('zzzzz-no-such-training');
    await expect(page.getByText('No matches.')).toBeVisible();
  });

  // SYS-UI-07 / VT-U12 / SR-095: on a list with expandable entries (Trainees), the expand/collapse-all
  // button toggles every entry's detail at once.
  test('SYS-UI-07 / VT-U12 / SR-095: expand/collapse-all toggles every entry on an expandable list', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainees');

    // Groups load expanded, so trainee detail (the seeded member) is visible.
    const trainee = page.getByText('Uma User').first();
    await expect(trainee).toBeVisible();

    // Collapse-all closes every group; the trainee detail is no longer shown.
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.getByText('Uma User')).toHaveCount(0);

    // The same control now reads "Expand all" and re-opens every group.
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.getByText('Uma User').first()).toBeVisible();
  });
});
