import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

import LoginPage from '@/pages/LoginPage.vue';
import AppLayout from '@/components/AppLayout.vue';
import DashboardPage from '@/pages/DashboardPage.vue';
import SessionPage from '@/pages/SessionPage.vue';
import TrainingsPage from '@/pages/TrainingsPage.vue';
import TraineesPage from '@/pages/TraineesPage.vue';
import RolesPage from '@/pages/RolesPage.vue';
import UsersPage from '@/pages/UsersPage.vue';
import SettingsPage from '@/pages/SettingsPage.vue';

// The Requirements / DMS tooling is internal-only: present in dev and in an internal build, but
// excluded from the public production bundle. The route is registered lazily and only when this flag
// is set, so Rollup drops the whole chunk (page + pdfmake + requirements/results data) from `npm run
// build`. Both operands are build-time constants, so the branch is constant-folded out.
const INTERNAL_TOOLS = import.meta.env.DEV || import.meta.env.VITE_INTERNAL === 'true';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: DashboardPage },
        { path: 'session/:trainingId', component: SessionPage },
        { path: 'trainings', component: TrainingsPage, meta: { requiresTrainerOrAdmin: true } },
        { path: 'trainees', component: TraineesPage, meta: { requiresTrainerOrAdmin: true } },
        { path: 'roles', component: RolesPage, meta: { requiresAdmin: true } },
        { path: 'users', component: UsersPage, meta: { requiresAdmin: true } },
        { path: 'settings', component: SettingsPage, meta: { requiresAdmin: true } },
        ...(INTERNAL_TOOLS
          ? [{ path: 'requirements', component: () => import('@/pages/RequirementsPage.vue'), meta: { requiresAdmin: true } }]
          : []),
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
  return true;
});

export default router;
