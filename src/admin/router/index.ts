import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/admin/stores/auth';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/admin/login',
            name: 'login',
            component: () => import('@/admin/views/LoginView.vue'),
            meta: { guest: true },
        },
        {
            path: '/admin',
            component: () => import('@/admin/layouts/AdminLayout.vue'),
            meta: { auth: true },
            children: [
                { path: '', name: 'dashboard', component: () => import('@/admin/views/DashboardView.vue') },
                { path: 'invitations', name: 'invitations', component: () => import('@/admin/views/InvitationsView.vue') },
                { path: 'invitations/create', name: 'invitations.create', component: () => import('@/admin/views/ChooseTemplateView.vue') },
                { path: 'invitations/:id/edit', name: 'invitations.edit', component: () => import('@/admin/views/EditorView.vue'), props: true },
                { path: 'invitations/:id/guests', name: 'invitations.guests', component: () => import('@/admin/views/GuestsView.vue'), props: true },
            ],
        },
        { path: '/admin/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
        // In dev, Vite serves this SPA for every path (in production the Node server
        // only serves it under /admin), so send anything else to the dashboard.
        { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
    ],
});

router.beforeEach(async (to) => {
    const auth = useAuthStore();
    if (!auth.ready) {
        await auth.fetchUser();
    }
    if (to.meta.auth && !auth.isAuthenticated) {
        return { name: 'login', query: { redirect: to.fullPath } };
    }
    if (to.meta.guest && auth.isAuthenticated) {
        return { name: 'dashboard' };
    }
    return true;
});

export default router;
