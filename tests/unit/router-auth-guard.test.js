import { beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../../src/router/index.js';

vi.mock('../../src/views/DashboardView.vue', () => ({ default: {} }));
vi.mock('../../src/views/SubscriptionGroupsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/ManualNodesView.vue', () => ({ default: {} }));
vi.mock('../../src/views/MySubscriptionsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/SettingsView.vue', () => ({ default: {} }));
vi.mock('../../src/views/HomeView.vue', () => ({ default: {} }));
vi.mock('../../src/views/Entrance.vue', () => ({ default: {} }));

beforeEach(async () => {
    await router.replace('/');
});

describe('management route authentication', () => {
    it.each([
        '/dashboard',
        '/dashboard/groups',
        '/dashboard/nodes',
        '/dashboard/subscriptions',
        '/dashboard/settings',
    ])(
        'keeps %s at its address so App can disguise it without exposing the login entry',
        async (path) => {
            await router.push(`${path}?filter=enabled`);
            expect(router.currentRoute.value.path).toBe(path);
            expect(router.currentRoute.value.query).toEqual({ filter: 'enabled' });
            expect(router.currentRoute.value.meta.requiresAuth).toBe(true);
        }
    );

    it('allows authenticated navigation', async () => {
        await router.push('/dashboard');
        expect(router.currentRoute.value.path).toBe('/dashboard');
    });

    it.each(['/', '/explore'])('allows the public route %s', async (path) => {
        await router.push(path);
        expect(router.currentRoute.value.path).toBe(path);
        expect(router.currentRoute.value.meta.isPublic).toBe(true);
    });
});
