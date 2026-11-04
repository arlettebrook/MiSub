import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router, { configureAuthGuard } from '../../src/router/index.js';

vi.mock('../../src/views/DashboardView.vue', () => ({ default: {} }));
vi.mock('../../src/views/SubscriptionGroupsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/ManualNodesView.vue', () => ({ default: {} }));
vi.mock('../../src/views/MySubscriptionsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/SettingsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/HomeView.vue', () => ({ default: {} }));
vi.mock('../../src/views/Entrance.vue', () => ({ default: {} }));

beforeEach(async () => {
    configureAuthGuard(() => ({ state: 'loggedOut', loginPath: '/admin-login' }));
    await router.replace('/');
});

afterEach(() => configureAuthGuard(null));

describe('management route authentication', () => {
    it.each([
        '/dashboard',
        '/dashboard/groups',
        '/dashboard/nodes',
        '/dashboard/subscriptions',
        '/dashboard/settings',
    ])('redirects a logged-out visitor from %s to their login entry', async (path) => {
        await router.push(`${path}?filter=enabled`);
        expect(router.currentRoute.value.path).toBe('/admin-login');
        expect(router.currentRoute.value.query.redirect).toBe(`${path}?filter=enabled`);
    });

    it('allows authenticated navigation', async () => {
        configureAuthGuard(() => ({ state: 'loggedIn', loginPath: '/admin-login' }));
        await router.push('/dashboard');
        expect(router.currentRoute.value.path).toBe('/dashboard');
    });

    it.each(['loading', 'loggedOut'])('allows public routes in state %s', async (state) => {
        configureAuthGuard(() => ({ state, loginPath: '/admin-login' }));
        await router.push('/explore');
        expect(router.currentRoute.value.path).toBe('/explore');
    });
});
