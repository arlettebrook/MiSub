import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ route: null, logic: null, push: vi.fn(), replace: vi.fn() }));
vi.mock('vue-router', async () => ({
    ...(await vi.importActual('vue-router')),
    useRouter: () => ({ push: controls.push, replace: controls.replace }),
    useRoute: () => controls.route,
}));
vi.mock('../../src/composables/useSettingsLogic.js', () => ({
    useSettingsLogic: () => controls.logic,
}));

import DashboardView from '../../src/views/DashboardView.vue';
import SubscriptionGroupsView from '../../src/views/SubscriptionGroupsView.vue';
import SettingsView from '../../src/views/SettingsView.vue';
import MySubscriptionsView from '../../src/views/MySubscriptionsView.vue';
import projectRouter from '../../src/router/index.js';
import { createI18n } from '../../src/i18n/index.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useSettingsStore } from '../../src/stores/settings.js';
import { getDashboardHealthItems } from '../../src/utils/dashboard-health.js';
import SubscriptionPanel from '../../src/components/subscriptions/SubscriptionPanel.vue';
import { useSubscriptions } from '../../src/composables/useSubscriptions.js';

let pinia;
const wrappers = [];
function mountView(view, locale = 'zh-CN', stubs = {}) {
    const wrapper = mount(view, {
        global: {
            plugins: [
                pinia,
                typeof locale === 'string' ? createI18n({ initialLocale: locale }) : locale,
            ],
            stubs: {
                RightPanel: true,
                SubscriptionPanel: true,
                ProfilePanel: true,
                BulkImportModal: true,
                ProfileModal: true,
                LogModal: true,
                QRCodeModal: true,
                Modal: true,
                SubscriptionEditModal: true,
                NodePreviewModal: true,
                BasicSettings: true,
                HomeSettings: true,
                GlobalSettings: true,
                ServiceSettings: true,
                ClientSettings: true,
                CustomPageSettings: true,
                SystemSettings: true,
                WebdavBackupSettings: true,
                MigrationModal: true,
                ...stubs,
            },
        },
    });
    wrappers.push(wrapper);
    return wrapper;
}

beforeEach(() => {
    controls.push.mockClear();
    controls.replace.mockReset().mockImplementation(async ({ query }) => {
        controls.route.query = query;
    });
    sessionStorage.clear();
    controls.route = reactive({ path: '/dashboard/settings', query: {} });
    controls.logic = {
        settings: ref({ mytoken: 'stable-token' }),
        disguiseConfig: ref({}),
        isLoading: ref(false),
        isSaving: ref(false),
        hasUnsavedChanges: ref(false),
        showMigrationModal: ref(false),
        hasWhitespace: ref(false),
        isStorageTypeValid: ref(true),
        loadSettings: vi.fn(async () => {}),
        handleSave: vi.fn(),
        handleMigrationSuccess: vi.fn(),
        handleReset: vi.fn(),
        exportBackup: vi.fn(),
        importBackup: vi.fn(),
    };
    pinia = createPinia();
    setActivePinia(pinia);
    const store = useDataStore(pinia);
    store.isLoading = false;
    useSettingsStore(pinia).setConfig({ mytoken: 'stable-token' });
    store.profiles = [{ id: 'p1', name: 'Daily', enabled: true }];
    store.subscriptions = [
        {
            id: 'failed',
            name: 'Failed',
            url: 'https://example.com/failed',
            enabled: true,
            nodeCount: 2,
            lastError: 'timeout',
        },
        {
            id: 'healthy',
            name: 'Healthy',
            url: 'https://example.com/healthy',
            enabled: true,
            nodeCount: 2,
        },
    ];
});
afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('dashboard action regressions', () => {
    it('primary failure button navigates and does not open logs', async () => {
        const wrapper = mountView(DashboardView);
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看失败订阅')
            .trigger('click');
        expect(controls.push).toHaveBeenCalledTimes(1);
        expect(wrapper.vm.showLogModal).toBe(false);
    });

    it('secondary failure button opens logs without navigation', async () => {
        const wrapper = mountView(DashboardView);
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '打开日志')
            .trigger('click');
        expect(wrapper.vm.showLogModal).toBe(true);
        expect(controls.push).not.toHaveBeenCalled();
    });

    it('keeps the primary button routing when the item also carries a legacy log action', async () => {
        const wrapper = mountView(DashboardView);
        wrapper.vm.dashboardHealthItems.find((item) => item.id === 'subscription-errors').action =
            'openLog';
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看失败订阅')
            .trigger('click');
        expect(controls.push).toHaveBeenCalledWith({
            path: '/dashboard/groups',
            query: { status: 'error' },
        });
        expect(wrapper.vm.showLogModal).toBe(false);
    });

    it('failure button routes to airport subscriptions', async () => {
        const wrapper = mountView(DashboardView);
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看失败订阅')
            .trigger('click');
        expect(projectRouter.resolve(controls.push.mock.calls[0][0]).name).toBe(
            'SubscriptionGroups'
        );
    });

    it.each(['error', 'disabled', 'expired', 'low-traffic', 'zero-nodes'])(
        'airport list respects status=%s',
        (status) => {
            const store = useDataStore(pinia);
            store.subscriptions[0].enabled = status !== 'disabled';
            store.subscriptions[0].lastError = status === 'error' ? 'timeout' : '';
            store.subscriptions[0].nodeCount = status === 'zero-nodes' ? 0 : 2;
            store.subscriptions[0].userInfo =
                status === 'expired'
                    ? { total: 100, expire: Math.floor(Date.now() / 1000) - 60 }
                    : status === 'low-traffic'
                      ? { total: 100, upload: 90 }
                      : undefined;
            controls.route.query = { status };
            const wrapper = mountView(SubscriptionGroupsView);
            expect(
                wrapper
                    .findComponent({ name: 'SubscriptionPanel' })
                    .props('paginatedSubscriptions')
                    .map((sub) => sub.id)
            ).toEqual(['failed']);
        }
    );

    it('Token deep link selects Basic Settings over a saved Service tab', async () => {
        sessionStorage.setItem('misub:settings-active-tab', 'service');
        controls.route.query = { focus: 'mytoken' };
        const wrapper = mountView(SettingsView);
        await flushPromises();
        expect(wrapper.vm.activeTab).toBe('basic');
    });

    it('English dashboard translates the health item title', () => {
        const wrapper = mountView(DashboardView, 'en-US');
        expect(wrapper.text()).not.toContain('个订阅最近更新失败');
    });

    it('keeps all five health issues so the UI can reveal the remainder', () => {
        const store = useDataStore(pinia);
        store.settings.mytoken = 'auto';
        store.subscriptions.push(
            {
                id: 'expired',
                enabled: true,
                nodeCount: 2,
                userInfo: { total: 100, expire: Math.floor(Date.now() / 1000) - 60 },
            },
            { id: 'low', enabled: true, nodeCount: 2, userInfo: { total: 100, upload: 90 } },
            { id: 'off', enabled: false, nodeCount: 2 }
        );
        expect(
            getDashboardHealthItems({
                subscriptions: store.subscriptions,
                profiles: store.profiles,
                settings: store.settings,
            })
        ).toHaveLength(5);
    });

    it('combines filtering with search, pagination, and query changes without altering stored subscriptions', async () => {
        const store = useDataStore(pinia);
        store.subscriptions = Array.from({ length: 9 }, (_, index) => ({
            id: `s${index}`,
            name: index === 7 ? 'Needle' : `Source ${index}`,
            url: `https://example.com/${index}`,
            enabled: true,
            nodeCount: 2,
            lastError: index < 8 ? 'timeout' : '',
        }));
        controls.route.query = { status: 'error' };
        const wrapper = mountView(SubscriptionGroupsView);
        const panel = () => wrapper.findComponent(SubscriptionPanel);
        expect(panel().props('totalPages')).toBe(2);
        panel().vm.$emit('changePage', 2);
        await flushPromises();
        expect(
            panel()
                .props('paginatedSubscriptions')
                .map((sub) => sub.id)
        ).toEqual(['s6', 's7']);
        panel().vm.$emit('updateSearch', 'needle');
        await flushPromises();
        expect(panel().props('currentPage')).toBe(1);
        expect(panel().props('filteredCount')).toBe(1);
        expect(panel().props('paginatedSubscriptions')[0].id).toBe('s7');
        controls.route.query = { status: 'disabled' };
        await flushPromises();
        expect(panel().props('filteredCount')).toBe(0);
        expect(store.subscriptions).toHaveLength(9);
    });

    it('clamps the page when refreshed sources stop matching the status filter', async () => {
        const store = useDataStore(pinia);
        store.subscriptions = Array.from({ length: 7 }, (_, i) => ({
            id: `s${i}`,
            url: `https://example.com/${i}`,
            lastError: 'timeout',
        }));
        const { subsCurrentPage, paginatedSubscriptions } = useSubscriptions(vi.fn(), {
            statusFilter: ref('error'),
        });
        subsCurrentPage.value = 2;
        store.subscriptions[6].lastError = '';
        await flushPromises();
        expect(subsCurrentPage.value).toBe(1);
        expect(paginatedSubscriptions.value).toHaveLength(6);
    });

    it.each([undefined, 'unknown', 'missing', ['ERROR', 'disabled']])(
        'handles status query %s without losing subscriptions',
        (status) => {
            controls.route.query = { status };
            const wrapper = mountView(SubscriptionGroupsView);
            expect(wrapper.findComponent(SubscriptionPanel).props('filteredCount')).toBe(
                Array.isArray(status) ? 1 : 2
            );
        }
    );

    it('offers an English filter banner and clears only the status query', async () => {
        controls.route.query = { status: 'disabled', source: 'dashboard' };
        controls.route.hash = '#sources';
        const wrapper = mountView(SubscriptionGroupsView, 'en-US', { SubscriptionPanel: false });
        expect(wrapper.get('[data-testid="subscription-status-filter"]').text()).toContain(
            'Showing disabled sources only'
        );
        expect(wrapper.text()).not.toContain('Clear search');
        await wrapper.get('[data-testid="subscription-status-filter-clear"]').trigger('click');
        await flushPromises();
        expect(controls.replace).toHaveBeenCalledWith({
            query: { source: 'dashboard' },
            hash: '#sources',
        });
        expect(wrapper.find('[data-testid="subscription-status-filter"]').exists()).toBe(false);
        expect(wrapper.findComponent(SubscriptionPanel).props('filteredCount')).toBe(2);
    });

    it.each(['mytoken', 'profileToken'])(
        'scrolls to and highlights the real %s input after settings finish loading',
        async (focus) => {
            const scroll = vi.fn();
            const original = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = scroll;
            try {
                controls.route.query = { focus };
                controls.logic.isLoading.value = true;
                const wrapper = mountView(SettingsView, 'zh-CN', { BasicSettings: false });
                await flushPromises();
                expect(scroll).not.toHaveBeenCalled();
                controls.logic.isLoading.value = false;
                await flushPromises();
                const input = wrapper.get(`#setting-${focus}`);
                expect(input.element.tagName).toBe('INPUT');
                expect(scroll.mock.contexts.at(-1)).toBe(input.element);
                expect(wrapper.vm.highlightedFocusId).toBe(`setting-${focus}`);
            } finally {
                Element.prototype.scrollIntoView = original;
            }
        }
    );

    it('reacts to Token query changes and clears highlighting for unknown focus values', async () => {
        const wrapper = mountView(SettingsView);
        controls.route.query = { focus: ['profileToken'] };
        await flushPromises();
        expect(wrapper.vm.highlightedFocusId).toBe('setting-profileToken');
        controls.route.query = { focus: 'unknown' };
        await flushPromises();
        expect(wrapper.vm.highlightedFocusId).toBe('');
    });

    it('reveals every pending item and updates its translated copy while mounted', async () => {
        const store = useDataStore(pinia);
        store.settings.mytoken = 'auto';
        store.subscriptions.push(
            {
                id: 'expired',
                url: 'https://example.com/expired',
                enabled: true,
                nodeCount: 2,
                userInfo: { expire: Math.floor(Date.now() / 1000) - 60 },
            },
            {
                id: 'low',
                url: 'https://example.com/low',
                enabled: true,
                nodeCount: 2,
                userInfo: { total: 100, upload: 90 },
            },
            { id: 'off', url: 'https://example.com/off', enabled: false, nodeCount: 2 }
        );
        const appI18n = createI18n({ initialLocale: 'zh-CN' });
        const wrapper = mountView(DashboardView, appI18n);
        expect(wrapper.text()).toContain('5 项');
        expect(wrapper.text()).not.toContain('1 个订阅已停用');
        await wrapper.get('[data-testid="health-items-toggle"]').trigger('click');
        expect(wrapper.text()).toContain('1 个订阅已停用');
        expect(wrapper.get('[data-testid="health-items-toggle"]').attributes('aria-expanded')).toBe(
            'true'
        );
        appI18n.setLocale('en-US');
        await flushPromises();
        expect(wrapper.text()).toContain('1 source(s) disabled');
        expect(wrapper.text()).toContain('Show less');
        expect(wrapper.text()).not.toMatch(/[\u4e00-\u9fff]/);
        await wrapper.get('[data-testid="health-items-toggle"]').trigger('click');
        expect(wrapper.text()).not.toContain('1 source(s) disabled');
    });

    it('resets the profiles page and scrolls to the profile section when requested', async () => {
        controls.route.path = '/dashboard/subscriptions';
        const scroll = vi.fn();
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = scroll;
        try {
            const wrapper = mountView(MySubscriptionsView);
            wrapper.vm.profilesCurrentPage = 2;
            controls.route.query = { focus: 'profiles' };
            await flushPromises();
            expect(wrapper.vm.profilesCurrentPage).toBe(1);
            expect(scroll.mock.contexts.at(-1)).toBe(wrapper.element);
        } finally {
            Element.prototype.scrollIntoView = original;
        }
    });
});
