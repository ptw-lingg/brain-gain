import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

import LoginPage from '@/pages/LoginPage.vue';
import ActivatePage from '@/pages/ActivatePage.vue';
import AppLayout from '@/components/AppLayout.vue';
import DashboardPage from '@/pages/DashboardPage.vue';
import SessionPage from '@/pages/SessionPage.vue';
import TrainingsPage from '@/pages/TrainingsPage.vue';
import TraineesPage from '@/pages/TraineesPage.vue';
import RolesPage from '@/pages/RolesPage.vue';
import OrgUnitsPage from '@/pages/OrgUnitsPage.vue';
import MyTeamPage from '@/pages/MyTeamPage.vue';
import UsersPage from '@/pages/UsersPage.vue';
import UsersImportPage from '@/pages/UsersImportPage.vue';
import SettingsPage from '@/pages/SettingsPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    { path: '/activate', component: ActivatePage, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: DashboardPage },
        { path: 'session/:trainingId', component: SessionPage },
        { path: 'my-team', component: MyTeamPage, meta: { requiresHeadOrAdmin: true } },
        { path: 'trainings', component: TrainingsPage, meta: { requiresTrainerOrAdmin: true } },
        { path: 'trainees', component: TraineesPage, meta: { requiresTrainerOrAdmin: true } },
        { path: 'roles', component: RolesPage, meta: { requiresAdmin: true } },
        { path: 'org-units', component: OrgUnitsPage, meta: { requiresAdmin: true } },
        { path: 'users', component: UsersPage, meta: { requiresAdmin: true } },
        { path: 'users/import', component: UsersImportPage, meta: { requiresAdmin: true } },
        { path: 'settings', component: SettingsPage, meta: { requiresAdmin: true } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (to.meta.requiresAuth && !auth.token) return '/login';

  // Ensure the user object is loaded so role-based guards work after a refresh.
  if (auth.token && !auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      auth.logout();
      return '/login';
    }
  }

  if (to.meta.requiresAdmin && !auth.user?.isAdmin) return '/dashboard';
  if (to.meta.requiresTrainerOrAdmin && !(auth.user?.isAdmin || auth.user?.isTrainer)) {
    return '/dashboard';
  }
  if (to.meta.requiresHeadOrAdmin && !(auth.user?.isAdmin || auth.user?.isHead)) {
    return '/dashboard';
  }
  return true;
});

export default router;
