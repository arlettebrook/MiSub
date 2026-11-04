import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import Entrance from '../../src/views/Entrance.vue';
import { useSessionStore } from '../../src/stores/session.js';

const apiMocks = vi.hoisted(() => ({
    fetchInitialData: vi.fn(),
    fetchPublicConfig: vi.fn(),
    login: vi.fn(),
}));
vi.mock('../../src/lib/api.js', () => apiMocks);
vi.mock('../../src/router/index.js', () => ({ default: { push: vi.fn() } }));
vi.mock('../../src/components/modals/Login.vue', () => ({
    __esModule: true,
    default: { template: '<form data-testid="login-entry" />' },
}));
vi.mock('../../src/views/NotFound.vue', () => ({
    __esModule: true,
    default: { template: '<div data-testid="not-found">404</div>' },
}));
vi.mock('../../src/views/DisguiseView.vue', () => ({
    __esModule: true,
    default: { template: '<div data-testid="disguise-page">404</div>' },
}));

let wrapper;
let router;
let store;

beforeEach(() => {
    sessionStorage.clear();
    apiMocks.fetchPublicConfig.mockReset().mockImplementation(async (path) => ({
        success: true,
        data: {
            enablePublicPage: true,
            hasCustomLoginPath: true,
            isLoginPath: path === '/admin-login',
        },
    }));
});

afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function openEntrance(path, sessionState = 'loggedOut') {
    const pinia = createPinia();
    store = useSessionStore(pinia);
    store.sessionState = sessionState;
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/dashboard',
                component: { template: '<section data-testid="dashboard">Dashboard</section>' },
            },
            { path: '/:pathMatch(.*)*', component: Entrance },
        ],
    });
    await router.push(path);
    wrapper = mount({ template: '<router-view />' }, { global: { plugins: [pinia, router] } });
    await flushPromises();
    await vi.dynamicImportSettled();
    await flushPromises();
}

describe('login entry path confirmation', () => {
    it.each(['/admin-login', '/login'])(
        'redirects an authenticated visitor from %s to the dashboard without showing a login form',
        async (path) => {
            if (path === '/login') {
                apiMocks.fetchPublicConfig.mockResolvedValue({
                    success: true,
                    data: { isLoginPath: true, hasCustomLoginPath: false },
                });
            }
            await openEntrance(path, 'loggedIn');
            expect(router.currentRoute.value.path).toBe('/dashboard');
            expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
            expect(wrapper.find('[data-testid="dashboard"]').exists()).toBe(true);
        }
    );

    it('waits for session restoration before redirecting an authenticated visitor', async () => {
        await openEntrance('/admin-login', 'loading');
        expect(apiMocks.fetchPublicConfig).not.toHaveBeenCalled();
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
        store.sessionState = 'loggedIn';
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/dashboard');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
    });

    it('keeps unknown paths as 404 pages for authenticated visitors', async () => {
        await openEntrance('/unknown', 'loggedIn');
        expect(router.currentRoute.value.path).toBe('/unknown');
        expect(wrapper.find('[data-testid="not-found"]').exists()).toBe(true);
    });

    it('recognizes and remembers the custom login entry without receiving its address', async () => {
        await openEntrance('/admin-login');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(true);
        expect(store.publicConfig).not.toHaveProperty('customLoginPath');
        expect(store.loginPath).toBe('/admin-login');
        expect(sessionStorage.getItem('misub:login-path')).toBe('/admin-login');
    });

    it('rechecks new routes instead of treating a previous positive match as a login page', async () => {
        await openEntrance('/admin-login');
        await router.push('/unknown');
        await flushPromises();
        await vi.dynamicImportSettled();
        await flushPromises();
        expect(apiMocks.fetchPublicConfig).toHaveBeenCalledWith('/unknown');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
        await router.push('/login');
        await flushPromises();
        await vi.dynamicImportSettled();
        await flushPromises();
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
    });

    it('keeps the default login entry available when no custom path is configured', async () => {
        apiMocks.fetchPublicConfig.mockResolvedValue({
            success: true,
            data: { isLoginPath: true, hasCustomLoginPath: false },
        });
        await openEntrance('/login');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(true);
        expect(store.loginPath).toBe('/login');
    });

    it('preserves a confirmed entry when browser storage is blocked', async () => {
        const storage = sessionStorage;
        vi.stubGlobal('sessionStorage', {
            getItem: (key) => storage.getItem(key),
            setItem: () => {
                throw new Error('storage blocked');
            },
        });
        await openEntrance('/admin-login');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(true);
        expect(store.loginPath).toBe('/admin-login');
    });

    it('keeps the default entry disguised when its confirmation request fails', async () => {
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: false, error: 'network down' });
        await openEntrance('/login');
        expect(apiMocks.fetchPublicConfig).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
        expect(store.publicConfig.enablePublicPage).toBe(false);
    });

    it('does not trust a remembered custom entry when the server cannot confirm it', async () => {
        sessionStorage.setItem('misub:login-path', '/admin-login');
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: false, error: 'network down' });
        await openEntrance('/admin-login');
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
        expect(router.currentRoute.value.path).toBe('/admin-login');
        expect(router.currentRoute.value.query.redirect).toBeUndefined();
    });
});
