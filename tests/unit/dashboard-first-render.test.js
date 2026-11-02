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

vi.mock('../../src/stores/session.js', async () => {
    const { defineStore } = await import('pinia');
    const { ref } = await import('vue');
    return {
        useSessionStore: defineStore('session', () => {
            const sessionState = ref('loading');
            return {
                sessionState,
                publicConfig: ref({ enablePublicPage: true }),
                subscriptionConfig: ref({}),
                checkSession: async () => {
                    sessionState.value = 'loggedIn';
                },
                login: vi.fn(),
                logout: vi.fn(),
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
const mountApp = (router, layoutMode = 'modern') => {
    const pinia = createPinia();
    useUIStore(pinia).layoutMode = layoutMode;
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

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe('authenticated dashboard first render', () => {
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
