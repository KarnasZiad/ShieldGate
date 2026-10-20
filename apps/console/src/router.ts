import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from 'vue-router';
import { useSessionStore } from './stores/session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Pages reachable without a session. */
    public?: boolean;
    /** Permission required to open the page; the API enforces it again on every request. */
    permission?: string;
    title?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('./views/LoginView.vue'),
    meta: { public: true, title: 'Connexion' },
  },
  { path: '/', redirect: '/account' },
  {
    path: '/account',
    component: () => import('./views/AccountView.vue'),
    meta: { title: 'Mon compte' },
  },
  {
    path: '/users',
    component: () => import('./views/UsersView.vue'),
    meta: { permission: 'users:read', title: 'Comptes' },
  },
  {
    path: '/api-keys',
    component: () => import('./views/ApiKeysView.vue'),
    meta: { permission: 'api-keys:read', title: 'Clés API' },
  },
  {
    path: '/policies',
    component: () => import('./views/PoliciesView.vue'),
    meta: { permission: 'policies:read', title: 'Politiques' },
  },
  {
    path: '/audit',
    component: () => import('./views/AuditView.vue'),
    meta: { permission: 'audit:read', title: 'Audit' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/account' },
];

/** Only same-application paths: never redirect to another site after sign-in. */
export function safeRedirect(target: unknown): string {
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
    ? target
    : '/account';
}

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({ history, routes });

  router.beforeEach(async (to) => {
    const session = useSessionStore();
    if (session.status === 'unknown') {
      await session.restore();
    }
    if (to.meta.public) {
      return session.authenticated && to.path === '/login' ? safeRedirect(to.query.redirect) : true;
    }
    if (!session.authenticated) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    if (to.meta.permission && !session.can(to.meta.permission)) {
      return '/account';
    }
    return true;
  });

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ShieldGate` : 'ShieldGate';
  });

  return router;
}
