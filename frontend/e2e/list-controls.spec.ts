import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for SYS-UI-07 (shared ListControls: per-list search) and the accordion behavior of expandable
// lists, derived from stakeholder SR-095 and validated by VT-U12. The search box appears on every
// list; expandable lists (Trainees, My Team) start fully collapsed and keep at most one entry open
// at a time — there is no expand-all/collapse-all control anywhere.
//
// Implementation under test:
//   frontend/src/components/ListControls.vue   (search box + shown/total count)
//   frontend/src/utils/listFilter.ts            (matchesQuery — case-insensitive visible-text match)
//   frontend/src/pages/TrainingsPage.vue        (search only)
//   frontend/src/pages/TraineesPage.vue         (search + accordion group rows)
test.describe('Lists — search & accordion', () => {
  // SYS-UI-07 / VT-U12 / SR-095: typing in the search box filters the list to entries whose visible
  // text matches; a non-matching query surfaces the "no matches" state.
  test('SYS-UI-07 / VT-U12 / SR-095: the list search box filters entries by visible text', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainings');

    // Both seeded trainings are listed initially.
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
    await expect(page.getByText('Quality Management Intro')).toBeVisible();

    // Searching narrows the list to matching entries (case-insensitive).
    const search = page.getByRole('searchbox');
    await search.fill('quality');
    await expect(page.getByText('Quality Management Intro')).toBeVisible();
    await expect(page.getByText('Laboratory Safety Basics')).toBeHidden();

    // A query that matches nothing shows the empty "no matches" state.
    await search.fill('zzzzz-no-such-training');
    await expect(page.getByText('No matches.')).toBeVisible();
  });

  // SYS-UI-07 / VT-U12 / SR-095: an expandable list (Trainees) starts collapsed and behaves as an
  // accordion — opening a second entry closes the first, and there is no expand/collapse-all button.
  // The seeded member is a trainee of BOTH groups, so their row count proves how many groups are open.
  test('SYS-UI-07 / VT-U12 / SR-095: expandable lists start collapsed and open one entry at a time', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainees');

    // Collapsed on entry: group titles show, trainee detail does not; no expand/collapse-all exists.
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
    await expect(page.getByText('Uma User')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand all' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse all' })).toHaveCount(0);

    // Opening a group reveals its trainees.
    await page.getByRole('button', { name: /Laboratory Safety Basics/ }).click();
    await expect(page.getByText('Uma User')).toHaveCount(1);

    // Accordion: opening the second group closes the first — the member's row count stays 1.
    await page.getByRole('button', { name: /Quality Management Intro/ }).click();
    await expect(page.getByText('Uma User')).toHaveCount(1);

    // Clicking the open group's header again closes it.
    await page.getByRole('button', { name: /Quality Management Intro/ }).click();
    await expect(page.getByText('Uma User')).toHaveCount(0);
  });
});
