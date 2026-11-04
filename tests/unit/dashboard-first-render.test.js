import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, onMounted, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.vue';
import HomeView from '../../src/views/HomeView.vue';
import { createI18n } from '../../src/i18n/index.js';
import { useUIStore } from '../../src/stores/ui.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useToastStore } from '../../src/stores/toast.js';
import SavePrompt from '../../src/components/ui/SavePrompt.vue';
import { loadLegacyDashboard } from '../../src/router/component-loaders.js';
import { useSessionStore } from '../../src/stores/session.js';

const sessionGate = vi.hoisted(() => ({ nextCheck: null }));

const legacyGate = vi.hoisted(() => {
    let resolve;
    const promise = new Promise((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
});

vi.mock('../../src/router/component-loaders.js', () => ({
    loadLegacyDashboard: () => legacyGate.promise,
}));

vi.mock('../../src/components/ui/SavePrompt.vue', () => ({
    __esModule: true,
    default: { name: 'SavePrompt', template: '<div />' },
}));

vi.mock('../../src/views/DisguiseView.vue', () => ({
    __esModule: true,
    default: { template: '<section data-testid="disguise-page">404</section>' },
}));
vi.mock('../../src/views/PublicProfilesView.vue', () => ({
    __esModule: true,
    default: { template: '<section data-testid="public-page">Public page</section>' },
}));

vi.mock('../../src/stores/session.js', async () => {
    const { defineStore } = await import('pinia');
    const { ref } = await import('vue');
    return {
        useSessionStore: defineStore('session', () => {
            const sessionState = ref('loading');
            return {
                sessionState,
                isLoggingOut: ref(false),
                publicConfig: ref({ enablePublicPage: true }),
                loginPath: ref('/login'),
                subscriptionConfig: ref({}),
                checkSession: async () => {
                    if (sessionGate.nextCheck) {
                        const check = sessionGate.nextCheck;
                        sessionGate.nextCheck = null;
                        return check();
                    }
                    sessionState.value = 'loggedIn';
                },
                suspendSession: () => {
                    sessionState.value = 'loading';
                },
                login: vi.fn(),
                logout: vi.fn(),
                handleUnauthorized: () => {
                    if (sessionState.value !== 'loggedIn') return false;
                    sessionState.value = 'loggedOut';
                    return true;
                },
            };
        }),
    };
});

vi.mock('../../src/stores/useDataStore.js', async () => {
    const { defineStore } = await import('pinia');
    const { ref } = await import('vue');
    return {
        useDataStore: defineStore('data', () => ({
            isDirty: ref(false),
            saveState: ref('idle'),
            fetchData: vi.fn(async () => true),
        })),
    };
});

vi.mock('../../src/lib/api.js', () => ({
    detectLegacyD1: vi.fn(async () => ({ success: true, data: { hasLegacyData: false } })),
    fetchGithubLatestRelease: vi.fn(async () => ({ tag_name: 'v2.6.0' })),
}));

const panel = { template: '<section data-testid="dashboard-panel">Dashboard panel</section>' };
const wrappers = [];
const mountApp = (router, layoutMode = 'modern', loginPath = '/login') => {
    const pinia = createPinia();
    useUIStore(pinia).layoutMode = layoutMode;
    useSessionStore(pinia).loginPath = loginPath;
    const wrapper = mount(App, {
        global: {
            plugins: [pinia, router, createI18n({ initialLocale: 'zh-CN' })],
            stubs: {
                NavBar: true,
                Header: true,
                Toast: true,
                SavePrompt: true,
                ScrollToTop: true,
                LegacyD1MigrationModal: true,
                VersionChangelogModal: true,
            },
        },
    });
    wrappers.push(wrapper);
    return wrapper;
};

afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    sessionGate.nextCheck = null;
});

describe('authenticated dashboard first render', () => {
    it.each(['modern', 'legacy'])(
        'disguises protected routes without mounting their page or login form in %s layout',
        async (layoutMode) => {
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [
                    {
                        path: '/dashboard/settings',
                        name: 'Settings',
                        component: panel,
                        meta: { requiresAuth: true },
                    },
                ],
            });
            await router.push('/dashboard/settings?tab=security');
            sessionGate.nextCheck = () => {
                useSessionStore().sessionState = 'loggedOut';
                return false;
            };
            const wrapper = mountApp(router, layoutMode, '/admin-login');
            await flushPromises();
            await vi.dynamicImportSettled();
            await flushPromises();
            expect(router.currentRoute.value.fullPath).toBe('/dashboard/settings?tab=security');
            expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
            expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(false);
            expect(wrapper.find('form').exists()).toBe(false);
            expect(wrapper.find('header-stub').exists()).toBe(false);
            expect(wrapper.find('footer').exists()).toBe(false);
        }
    );

    it.each([true, false])(
        'shows the root public page or disguise according to enablePublicPage=%s',
        async (enabled) => {
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [
                    { path: '/', name: 'Home', component: HomeView, meta: { isPublic: true } },
                ],
            });
            await router.push('/');
            sessionGate.nextCheck = () => {
                const store = useSessionStore();
                store.publicConfig = { enablePublicPage: enabled };
                store.sessionState = 'loggedOut';
                return false;
            };
            const wrapper = mountApp(router);
            await flushPromises();
            await vi.dynamicImportSettled();
            await flushPromises();
            expect(router.currentRoute.value.path).toBe('/');
            expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(!enabled);
            expect(wrapper.find('[data-testid="public-page"]').exists()).toBe(enabled);
            expect(wrapper.find('form').exists()).toBe(false);
            if (!enabled) expect(wrapper.find('footer').exists()).toBe(false);
        }
    );

    it('revalidates a cached dashboard before resuming it after logout in another document', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                {
                    path: '/dashboard',
                    name: 'Dashboard',
                    component: panel,
                    meta: { requiresAuth: true },
                },
                {
                    path: '/admin-login',
                    name: 'Entrance',
                    component: { template: '<form data-testid="login-entry" />' },
                    meta: { isPublic: true },
                },
            ],
        });
        await router.push('/dashboard');
        const wrapper = mountApp(router, 'modern', '/admin-login');
        await flushPromises();
        const store = useSessionStore(wrapper.vm.$pinia);
        let finishSession;
        const checkSession = vi.fn(
            () =>
                new Promise((resolve) => {
                    finishSession = () => {
                        store.sessionState = 'loggedOut';
                        resolve(false);
                    };
                })
        );
        sessionGate.nextCheck = checkSession;
        const hide = new Event('pagehide');
        Object.defineProperty(hide, 'persisted', { value: true });
        window.dispatchEvent(hide);
        await flushPromises();
        expect(store.sessionState).toBe('loading');
        expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(false);
        const show = new Event('pageshow');
        Object.defineProperty(show, 'persisted', { value: true });
        window.dispatchEvent(show);
        await flushPromises();
        expect(checkSession).toHaveBeenCalledTimes(1);
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        window.dispatchEvent(new CustomEvent('misub:unauthorized'));
        finishSession();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/dashboard');
        expect(router.currentRoute.value.query.redirect).toBeUndefined();
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
        expect(useToastStore(wrapper.vm.$pinia).toasts).toHaveLength(0);
    });

    it.each(['/login', '/admin-login'])(
        'keeps the login entry %s hidden until the restored session reaches the dashboard',
        async (loginPath) => {
            let finishRoute;
            const routeChunk = new Promise((resolve) => {
                finishRoute = resolve;
            });
            const loginMounted = vi.fn();
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [
                    {
                        path: loginPath,
                        name: 'Entrance',
                        component: {
                            template: '<form data-testid="login-entry" />',
                            mounted: loginMounted,
                        },
                        meta: { isPublic: true },
                    },
                    { path: '/dashboard', name: 'Dashboard', component: () => routeChunk },
                ],
            });
            await router.push(loginPath);
            const wrapper = mountApp(router, 'modern', loginPath);
            await flushPromises();
            expect(wrapper.find('main [role="status"]').exists()).toBe(true);
            expect(wrapper.find('[data-testid="login-entry"]').exists()).toBe(false);
            expect(loginMounted).not.toHaveBeenCalled();

            finishRoute(panel);
            await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/dashboard'));
            await flushPromises();
            expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(true);
            expect(loginMounted).not.toHaveBeenCalled();
        }
    );

    it('disguises an expired session at its current address with one notification', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                {
                    path: '/dashboard',
                    name: 'Dashboard',
                    component: panel,
                    meta: { requiresAuth: true },
                },
                {
                    path: '/admin-login',
                    name: 'Entrance',
                    component: { template: '<div>Login</div>' },
                    meta: { isPublic: true },
                },
            ],
        });
        await router.push('/dashboard?filter=enabled');
        const wrapper = mountApp(router);
        await flushPromises();
        useSessionStore(wrapper.vm.$pinia).loginPath = '/admin-login';
        const toast = vi.spyOn(useToastStore(wrapper.vm.$pinia), 'showToast');
        window.dispatchEvent(new CustomEvent('misub:unauthorized'));
        window.dispatchEvent(new CustomEvent('misub:unauthorized'));
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/dashboard?filter=enabled');
        expect(router.currentRoute.value.query.redirect).toBeUndefined();
        expect(wrapper.find('[data-testid="disguise-page"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(false);
        expect(toast).toHaveBeenCalledTimes(1);
        toast.mockRestore();
    });
    it.each([false, true])(
        'announces discarded changes only after a successful reload (%s)',
        async (success) => {
            const router = createRouter({
                history: createMemoryHistory(),
                routes: [{ path: '/dashboard', name: 'Dashboard', component: panel }],
            });
            await router.push('/dashboard');
            const wrapper = mountApp(router);
            await flushPromises();
            const store = useDataStore(wrapper.vm.$pinia);
            store.isDirty = true;
            const fetchData = vi.spyOn(store, 'fetchData').mockResolvedValue(success);
            const toast = vi.spyOn(useToastStore(wrapper.vm.$pinia), 'showToast');
            await flushPromises();

            wrapper.findComponent(SavePrompt).vm.$emit('discard');
            await flushPromises();

            expect(fetchData).toHaveBeenLastCalledWith(true);
            expect(toast).toHaveBeenCalledTimes(success ? 1 : 0);
            fetchData.mockRestore();
            toast.mockRestore();
        }
    );

    it('keeps the loading screen and hides the footer while the initial route chunk is pending', async () => {
        let finishRoute;
        const routeChunk = new Promise((resolve) => {
            finishRoute = resolve;
        });
        const history = createMemoryHistory();
        history.replace('/dashboard');
        const router = createRouter({
            history,
            routes: [{ path: '/dashboard', name: 'Dashboard', component: () => routeChunk }],
        });
        const wrapper = mountApp(router);
        await flushPromises();
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        expect(wrapper.findAll('main [aria-busy="true"]')).toHaveLength(0);
        expect(wrapper.find('footer').exists()).toBe(false);

        finishRoute(panel);
        await router.isReady();
        await flushPromises();
        expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(true);
        expect(wrapper.find('footer').exists()).toBe(true);
    });

    it('does not reveal the footer for the home placeholder before dashboard redirection finishes', async () => {
        let finishRoute;
        const routeChunk = new Promise((resolve) => {
            finishRoute = resolve;
        });
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', name: 'Home', component: HomeView },
                { path: '/dashboard', name: 'Dashboard', component: () => routeChunk },
            ],
        });
        await router.push('/');
        const wrapper = mountApp(router);
        await flushPromises();
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        expect(wrapper.findAll('main [aria-busy="true"]')).toHaveLength(0);
        expect(wrapper.find('footer').exists()).toBe(false);

        finishRoute(panel);
        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/dashboard'));
        await flushPromises();
        expect(wrapper.find('[data-testid="dashboard-panel"]').exists()).toBe(true);
        expect(wrapper.find('footer').exists()).toBe(true);
    });

    it('waits for the actual legacy dashboard instead of treating the async wrapper as mounted content', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/dashboard', name: 'Dashboard', component: panel }],
        });
        await router.push('/dashboard');
        const wrapper = mountApp(router, 'legacy');
        await flushPromises();
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        expect(wrapper.findAll('main [aria-busy="true"]')).toHaveLength(0);
        expect(wrapper.find('footer').exists()).toBe(false);

        legacyGate.resolve({
            __esModule: true,
            default: { template: '<section data-testid="legacy-panel">Legacy dashboard</section>' },
        });
        await loadLegacyDashboard();
        await flushPromises();
        expect(wrapper.find('[data-testid="legacy-panel"]').exists()).toBe(true);
        expect(wrapper.find('footer').exists()).toBe(true);
    });

    it('waits for settings data after navigating from a ready dashboard', async () => {
        let finishSettings;
        const settingsData = new Promise((resolve) => {
            finishSettings = resolve;
        });
        const settingsPanel = defineComponent({
            emits: ['content-ready'],
            setup(_, { emit }) {
                const loaded = ref(false);
                onMounted(async () => {
                    await settingsData;
                    loaded.value = true;
                    emit('content-ready', '/dashboard/settings');
                });
                return { loaded };
            },
            template:
                '<section><p v-if="!loaded" role="status">Loading settings</p><div v-else data-testid="settings-fields">Settings fields</div></section>',
        });
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/dashboard', name: 'Dashboard', component: panel },
                { path: '/dashboard/settings', name: 'Settings', component: settingsPanel },
            ],
        });
        await router.push('/dashboard');
        const wrapper = mountApp(router);
        await flushPromises();
        expect(wrapper.find('footer').exists()).toBe(true);

        await router.push('/dashboard/settings');
        await flushPromises();
        expect(wrapper.find('main [role="status"]').exists()).toBe(true);
        expect(wrapper.find('footer').exists()).toBe(false);

        finishSettings();
        await flushPromises();
        expect(wrapper.find('[data-testid="settings-fields"]').exists()).toBe(true);
        expect(wrapper.find('footer').exists()).toBe(true);
    });
});
