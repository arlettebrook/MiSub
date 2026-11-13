import { createRouter, createWebHistory } from 'vue-router';
import { navigationLoaders } from './navigation-loaders.js';

const HomeView = () => import('../views/HomeView.vue'); // [NEW] Wrapper View

const routes = [
    {
        path: '/', // Root path is HomeView (Smart Wrapper)
        name: 'Home',
        component: HomeView,
        meta: { title: '首页', isPublic: true }, // Publicly accessible, view handles content
    },
    {
        path: '/explore',
        name: 'Explore',
        component: HomeView,
        meta: { title: '公开页', isPublic: true },
    },
    {
        path: '/dashboard',
        name: 'Dashboard',
        component: navigationLoaders['/dashboard'],
        meta: { title: '仪表盘', requiresAuth: true },
    },
    {
        path: '/dashboard/groups',
        name: 'SubscriptionGroups',
        component: navigationLoaders['/dashboard/groups'],
        meta: { title: '订阅组', requiresAuth: true },
    },
    {
        path: '/dashboard/nodes',
        name: 'ManualNodes',
        component: navigationLoaders['/dashboard/nodes'],
        meta: { title: '手动节点', requiresAuth: true },
    },
    {
        path: '/dashboard/subscriptions',
        name: 'MySubscriptions',
        component: navigationLoaders['/dashboard/subscriptions'],
        meta: { title: '我的订阅', requiresAuth: true },
    },
    {
        path: '/dashboard/settings',
        name: 'Settings',
        component: navigationLoaders['/dashboard/settings'],
        meta: { title: '设置', requiresAuth: true },
    },
    /* 
    // [REMOVED] Static /login route. 
    // Handled dynamically by Catch-All route (Entrance.vue) to support Custom Login Path.
    {
        path: '/login',
        name: 'Login',
        component: () => import('../components/modals/Login.vue'),
        meta: { title: '登录', isPublic: false } 
    }, 
    */
    {
        // Catch-all route for Custom Login Path or 404
        path: '/:pathMatch(.*)*',
        name: 'Entrance',
        component: () => import('../views/Entrance.vue'),
        meta: { title: 'MiSub', isPublic: true }, // Public, so Entrance.vue can decide what to render
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior(to, from, savedPosition) {
        if (savedPosition) {
            return savedPosition;
        } else {
            return { top: 0 };
        }
    },
});

// 自动恢复动态 chunk 加载失败导致的白屏
router.onError((error) => {
    const message = error?.message || '';
    if (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('error loading dynamically imported module')
    ) {
        const reloadKey = 'misub:chunk-reload';
        if (sessionStorage.getItem(reloadKey) !== '1') {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
        }
    }
});

// App renders protected routes according to the current session without revealing the login entry.
router.beforeEach((to) => {
    // Update title
    if (typeof document !== 'undefined') {
        document.title = to.meta.title ? `${to.meta.title} - MISUB` : 'MISUB';
    }
});

export default router;
