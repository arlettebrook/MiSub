import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ route: null, logic: null, push: vi.fn(), replace: vi.fn() }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), ids: null }));
vi.mock('../../src/lib/http.js', async () => {
    const actual = await vi.importActual('../../src/lib/http.js');
    return {
        ...actual,
        api: {
            ...actual.api,
            get: (url, ...args) =>
                url === '/api/dashboard/preferences'
                    ? preferences.get()
                    : actual.api.get(url, ...args),
            post: (url, body, ...args) =>
                url === '/api/dashboard/preferences'
                    ? preferences.post(body)
                    : actual.api.post(url, body, ...args),
        },
    };
});
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
    preferences.ids = null;
    preferences.get
        .mockReset()
        .mockImplementation(async () => ({
            success: true,
            initialized: preferences.ids != null,
            data: { dismissedHealthItemIds: [...(preferences.ids || [])] },
        }));
    preferences.post.mockReset().mockImplementation(async (body) => {
        let ids = preferences.ids || [];
        if (body.action === 'dismiss') ids = [...new Set([...ids, body.id])];
        if (body.action === 'restore') ids = ids.filter((id) => id !== body.id);
        if (body.action === 'restore-all') ids = [];
        if (body.action === 'migrate' && preferences.ids == null) ids = body.ids;
        preferences.ids = [...ids];
        return { success: true, initialized: true, data: { dismissedHealthItemIds: [...ids] } };
    });
    controls.push.mockClear();
    controls.replace.mockReset().mockImplementation(async ({ query }) => {
        controls.route.query = query;
    });
    sessionStorage.clear();
    localStorage.removeItem('misub:dismissedHealthItems');
    localStorage.removeItem('misub:dismissedHealthItems:pending');
    localStorage.removeItem('misub:dismissedHealthItems:serverSynced');
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
afterEach(async () => {
    await flushPromises();
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    sessionStorage.clear();
    localStorage.removeItem('misub:dismissedHealthItems');
    localStorage.removeItem('misub:dismissedHealthItems:pending');
    localStorage.removeItem('misub:dismissedHealthItems:serverSynced');
    vi.restoreAllMocks();
});

describe('dashboard action regressions', () => {
    it('restores one ignored issue while keeping other issues ignored across remounts', async () => {
        const store = useDataStore(pinia);
        store.subscriptions[0].userInfo = { expire: 1 };
        store.subscriptions[1].name = 'Failed';
        store.subscriptions[1].lastError = 'HTTP 503';
        const originalSubscriptions = JSON.stringify(store.subscriptions);
        const wrapper = mountView(DashboardView);
        for (const button of wrapper.findAll('[data-testid="health-item-dismiss"]')) {
            await button.trigger('click');
        }
        expect(wrapper.vm.dashboardHealthItems).toEqual([]);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(3);
        expect(wrapper.find('[data-testid="dismissed-health-item"]').exists()).toBe(false);
        const toggle = wrapper.get('[data-testid="health-items-dismissed-toggle"]');
        expect(toggle.attributes('aria-expanded')).toBe('false');
        await toggle.trigger('click');
        expect(toggle.attributes('aria-expanded')).toBe('true');
        expect(wrapper.findAll('[data-testid="dismissed-health-item"]')).toHaveLength(3);
        const item = wrapper.get(
            '[data-testid="dismissed-health-item"][data-health-item-id="subscription-errors:failed"]'
        );
        expect(item.text()).toContain('更新失败：timeout');
        expect(item.get('[data-testid="health-item-restore"]').attributes('aria-label')).toContain(
            'Failed：最近更新失败'
        );
        await item.get('[data-testid="health-item-restore"]').trigger('click');

        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'subscription-errors:failed',
        ]);
        expect(wrapper.vm.dismissedHealthItems.map((item) => item.id)).toEqual([
            'subscription-errors:healthy',
            'expired-subscriptions:failed',
        ]);
        expect(wrapper.findAll('[data-testid="dismissed-health-item"]')).toHaveLength(2);
        expect(JSON.parse(localStorage.getItem('misub:dismissedHealthItems'))).toEqual([
            'subscription-errors:healthy',
            'expired-subscriptions:failed',
        ]);
        expect(JSON.stringify(store.subscriptions)).toBe(originalSubscriptions);
        expect(store.isDirty).toBe(false);

        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
        const remounted = mountView(DashboardView);
        expect(remounted.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'subscription-errors:failed',
        ]);
        expect(remounted.vm.dismissedHealthItemsCount).toBe(2);
        await remounted.get('[data-testid="health-items-dismissed-toggle"]').trigger('click');
        await remounted
            .get(
                '[data-testid="dismissed-health-item"][data-health-item-id="subscription-errors:healthy"]'
            )
            .get('[data-testid="health-item-restore"]')
            .trigger('click');
        expect(remounted.vm.dismissedHealthItemsCount).toBe(1);
        await remounted.get('[data-testid="health-item-restore"]').trigger('click');
        expect(remounted.vm.dashboardHealthItems).toHaveLength(3);
        expect(remounted.vm.dismissedHealthItemsCount).toBe(0);
        expect(remounted.find('[data-testid="health-items-dismissed-toggle"]').exists()).toBe(
            false
        );
        expect(remounted.find('[data-testid="health-items-restore"]').exists()).toBe(false);
    });

    it('keeps disabled subscriptions and resolved issues out of the ignored-items list', async () => {
        const store = useDataStore(pinia);
        store.subscriptions[1].lastError = 'HTTP 503';
        const wrapper = mountView(DashboardView);
        for (const button of wrapper.findAll('[data-testid="health-item-dismiss"]')) {
            await button.trigger('click');
        }
        await wrapper.get('[data-testid="health-items-dismissed-toggle"]').trigger('click');
        expect(wrapper.findAll('[data-testid="dismissed-health-item"]')).toHaveLength(2);

        store.subscriptions[0].enabled = false;
        await flushPromises();
        expect(wrapper.findAll('[data-testid="dismissed-health-item"]')).toHaveLength(1);
        expect(wrapper.vm.dismissedHealthItems.map((item) => item.id)).toEqual([
            'subscription-errors:healthy',
        ]);
        store.subscriptions[1].lastError = '';
        await flushPromises();
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(0);
        expect(wrapper.find('[data-testid="dismissed-health-item"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="health-items-dismissed-toggle"]').exists()).toBe(false);
        expect(wrapper.vm.dashboardHealthItems).toEqual([]);
    });

    it('removes subscription reminders immediately when all sources are disabled', async () => {
        const store = useDataStore(pinia);
        store.subscriptions[0].nodeCount = 0;
        store.subscriptions[0].userInfo = { expire: 1 };
        store.subscriptions[1].nodeCount = 0;
        store.subscriptions[1].userInfo = { total: 100, upload: 90 };
        const wrapper = mountView(DashboardView);
        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'zero-nodes',
            'subscription-errors:failed',
            'expired-subscriptions:failed',
            'low-traffic:healthy',
        ]);

        store.subscriptions[0].enabled = false;
        await flushPromises();
        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'zero-nodes',
            'low-traffic:healthy',
        ]);
        store.subscriptions[1].enabled = false;
        await flushPromises();
        expect(wrapper.vm.dashboardHealthItems).toEqual([]);
        expect(wrapper.findAll('[data-testid="health-item"]')).toHaveLength(0);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(0);

        store.subscriptions[0].enabled = true;
        await flushPromises();
        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'zero-nodes',
            'subscription-errors:failed',
            'expired-subscriptions:failed',
        ]);
    });

    it('shows three named failures and dismisses only the selected source across remounts', async () => {
        const store = useDataStore(pinia);
        store.subscriptions[1].name = 'Failed';
        store.subscriptions[1].lastError = 'HTTP 503';
        store.subscriptions.push({
            id: 'third',
            name: 'Third',
            url: 'https://example.com/third',
            enabled: true,
            nodeCount: 2,
            lastError: 'network unavailable',
        });
        localStorage.setItem('misub:dismissedHealthItems', JSON.stringify(['subscription-errors']));
        const originalSubscriptions = JSON.stringify(store.subscriptions);
        const wrapper = mountView(DashboardView);
        const row = (id) => wrapper.get(`[data-health-item-id="subscription-errors:${id}"]`);
        expect(wrapper.findAll('[data-testid="health-item"]')).toHaveLength(3);
        expect(wrapper.text()).toContain('3 项');
        expect(wrapper.text()).not.toContain('3 个订阅最近更新失败');
        expect(row('failed').text()).toContain('Failed：最近更新失败');
        expect(row('failed').text()).toContain('更新失败：timeout');
        expect(row('healthy').text()).toContain('更新失败：HTTP 503');
        expect(row('third').text()).toContain('Third：最近更新失败');

        await row('healthy').get('[data-testid="health-item-dismiss"]').trigger('click');
        expect(wrapper.vm.dashboardHealthItems.map((item) => item.subscriptionId)).toEqual([
            'failed',
            'third',
        ]);
        expect(wrapper.text()).toContain('2 项');
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(1);
        expect(JSON.stringify(store.subscriptions)).toBe(originalSubscriptions);
        expect(store.isDirty).toBe(false);

        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
        store.subscriptions[1].name = 'Renamed';
        store.subscriptions.reverse();
        const remounted = mountView(DashboardView);
        expect(remounted.vm.dashboardHealthItems.map((item) => item.subscriptionId)).toEqual([
            'third',
            'failed',
        ]);
        await remounted.get('[data-testid="health-items-restore"]').trigger('click');
        expect(remounted.findAll('[data-testid="health-item"]')).toHaveLength(3);
        expect(remounted.text()).toContain('Renamed：最近更新失败');
    });

    it('opens the exact source and clears its filter while preserving unrelated query values', async () => {
        const store = useDataStore(pinia);
        store.subscriptions[1].name = 'Failed';
        store.subscriptions[1].lastError = 'timeout';
        store.subscriptions.push({
            id: 'Case-ID',
            name: 'Uppercase',
            url: 'https://example.com/uppercase',
            enabled: true,
            nodeCount: 2,
            lastError: 'HTTP 503',
        });
        const dashboard = mountView(DashboardView);
        await dashboard
            .get('[data-health-item-id="subscription-errors:healthy"]')
            .get('[data-testid="health-item-action"]')
            .trigger('click');
        expect(controls.push).toHaveBeenCalledWith({
            path: '/dashboard/groups',
            query: { status: 'error', subscription: 'healthy' },
        });
        controls.route.query = { ...controls.push.mock.calls[0][0].query, source: 'dashboard' };
        controls.route.hash = '#sources';
        const groups = mountView(SubscriptionGroupsView, 'zh-CN', { SubscriptionPanel: false });
        const panel = () => groups.findComponent(SubscriptionPanel);
        expect(
            panel()
                .props('paginatedSubscriptions')
                .map((sub) => sub.id)
        ).toEqual(['healthy']);
        expect(groups.get('[data-testid="subscription-status-filter"]').text()).toContain(
            '仅显示订阅「Failed」'
        );

        groups.vm.subsCurrentPage = 2;
        controls.route.query = { ...controls.route.query, subscription: ['Case-ID', 'healthy'] };
        await flushPromises();
        expect(panel().props('currentPage')).toBe(1);
        expect(
            panel()
                .props('paginatedSubscriptions')
                .map((sub) => sub.id)
        ).toEqual(['Case-ID']);
        expect(groups.text()).toContain('仅显示订阅「Uppercase」');
        controls.route.query = { ...controls.route.query, subscription: 'missing-source' };
        await flushPromises();
        expect(panel().props('filteredCount')).toBe(0);

        await groups.get('[data-testid="subscription-status-filter-clear"]').trigger('click');
        await flushPromises();
        expect(controls.replace).toHaveBeenCalledWith({
            query: { source: 'dashboard' },
            hash: '#sources',
        });
        expect(panel().props('filteredCount')).toBe(3);
        expect(groups.find('[data-testid="subscription-status-filter"]').exists()).toBe(false);
    });

    it('dismisses an item locally while preserving source data and other pending items', async () => {
        const store = useDataStore(pinia);
        store.settings.mytoken = 'auto';
        const originalSubscriptions = JSON.stringify(store.subscriptions);
        const wrapper = mountView(DashboardView);
        expect(wrapper.find('[data-testid="health-items-restore"]').exists()).toBe(false);

        await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');

        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'subscription-errors:failed',
        ]);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(1);
        expect(wrapper.get('[data-testid="health-items-dismissed-toggle"]').text()).toContain(
            '已忽略 1 项'
        );
        expect(JSON.stringify(store.subscriptions)).toBe(originalSubscriptions);
        expect(store.settings.mytoken).toBe('auto');
        expect(store.isDirty).toBe(false);
        expect(controls.push).not.toHaveBeenCalled();
    });

    it('restores every item after dismissing the whole list', async () => {
        const store = useDataStore(pinia);
        store.settings.mytoken = 'auto';
        const wrapper = mountView(DashboardView);
        await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');
        await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');

        expect(wrapper.vm.hasHealthItems).toBe(false);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(2);
        expect(wrapper.get('[data-testid="health-items-dismissed-toggle"]').text()).toContain(
            '已忽略 2 项'
        );

        await wrapper.get('[data-testid="health-items-restore"]').trigger('click');
        expect(wrapper.vm.dashboardHealthItems.map((item) => item.id)).toEqual([
            'auto-token',
            'subscription-errors:failed',
        ]);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(0);
        expect(wrapper.find('[data-testid="health-items-restore"]').exists()).toBe(false);
        expect(localStorage.getItem('misub:dismissedHealthItems')).toBeNull();
    });

    it('persists dismissal across remounts', async () => {
        const first = mountView(DashboardView);
        await first.get('[data-testid="health-item-dismiss"]').trigger('click');
        first.unmount();
        wrappers.splice(wrappers.indexOf(first), 1);

        const second = mountView(DashboardView);
        expect(second.vm.dashboardHealthItems).toEqual([]);
        expect(second.vm.dismissedHealthItemsCount).toBe(1);
        expect(second.find('[data-testid="health-items-restore"]').exists()).toBe(true);
    });

    it('counts only dismissed issues that still exist', async () => {
        const store = useDataStore(pinia);
        const wrapper = mountView(DashboardView);
        await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');
        store.subscriptions[0].lastError = '';
        await flushPromises();
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(0);
        expect(wrapper.find('[data-testid="health-items-restore"]').exists()).toBe(false);

        store.subscriptions[0].lastError = 'timeout';
        await flushPromises();
        expect(wrapper.vm.dashboardHealthItems).toEqual([]);
        expect(wrapper.vm.dismissedHealthItemsCount).toBe(1);
    });

    it('fills the collapsed list with remaining items when one is dismissed', async () => {
        const store = useDataStore(pinia);
        store.profiles[0].enabled = false;
        store.settings.mytoken = 'auto';
        store.subscriptions.push(
            {
                id: 'expired',
                url: 'https://example.com/expired',
                enabled: true,
                nodeCount: 2,
                userInfo: { expire: 1 },
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
        const wrapper = mountView(DashboardView);
        expect(wrapper.vm.hiddenHealthItemsCount).toBe(1);
        await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');
        expect(wrapper.findAll('[data-testid="health-item-dismiss"]')).toHaveLength(4);
        expect(wrapper.vm.hiddenHealthItemsCount).toBe(0);
        expect(wrapper.text()).toContain('未命名订阅：流量不足');
        expect(wrapper.text()).not.toContain('1 个订阅已停用');
        expect(wrapper.find('[data-testid="health-items-toggle"]').exists()).toBe(false);
    });

    it.each([
        ['zh-CN', '有待处理项', '待处理事项', '忽略', '已忽略 1 项', '全部恢复', '恢复'],
        [
            'en-US',
            'Items pending',
            'Pending items',
            'Dismiss',
            '1 dismissed',
            'Restore all',
            'Restore',
        ],
    ])(
        'renders distinct status and list copy in %s',
        async (locale, status, title, dismiss, dismissed, restoreAll, restoreItem) => {
            const wrapper = mountView(DashboardView, locale);
            expect(wrapper.vm.readinessText).toBe(status);
            expect(wrapper.findAll('h3').map((heading) => heading.text())).toContain(title);
            expect(wrapper.get('[data-testid="health-item-dismiss"]').text()).toBe(dismiss);
            expect(
                wrapper.get('[data-testid="health-item-dismiss"]').attributes('aria-label')
            ).toBeTruthy();
            await wrapper.get('[data-testid="health-item-dismiss"]').trigger('click');
            expect(wrapper.get('[data-testid="health-items-dismissed-toggle"]').text()).toBe(
                dismissed
            );
            expect(wrapper.get('[data-testid="health-items-restore"]').text()).toBe(restoreAll);
            await wrapper.get('[data-testid="health-items-dismissed-toggle"]').trigger('click');
            expect(wrapper.get('[data-testid="health-item-restore"]').text()).toBe(restoreItem);
            expect(wrapper.text()).not.toContain('dashboard.');
        }
    );

    it('primary failure button navigates and does not open logs', async () => {
        const wrapper = mountView(DashboardView);
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看订阅')
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
        wrapper.vm.dashboardHealthItems.find(
            (item) => item.id === 'subscription-errors:failed'
        ).action = 'openLog';
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看订阅')
            .trigger('click');
        expect(controls.push).toHaveBeenCalledWith({
            path: '/dashboard/groups',
            query: { status: 'error', subscription: 'failed' },
        });
        expect(wrapper.vm.showLogModal).toBe(false);
    });

    it('failure button routes to airport subscriptions', async () => {
        const wrapper = mountView(DashboardView);
        await wrapper
            .findAll('button')
            .find((button) => button.text() === '查看订阅')
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

    it('counts actionable health issues without a disabled-subscription reminder', () => {
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
        ).toHaveLength(4);
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
        store.profiles[0].enabled = false;
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
        expect(wrapper.text()).not.toContain('未命名订阅：流量不足');
        expect(wrapper.text()).not.toContain('1 个订阅已停用');
        await wrapper.get('[data-testid="health-items-toggle"]').trigger('click');
        expect(wrapper.text()).toContain('未命名订阅：流量不足');
        expect(wrapper.text()).not.toContain('1 个订阅已停用');
        expect(wrapper.get('[data-testid="health-items-toggle"]').attributes('aria-expanded')).toBe(
            'true'
        );
        appI18n.setLocale('en-US');
        await flushPromises();
        expect(wrapper.text()).toContain('Unnamed: low traffic');
        expect(wrapper.text()).not.toContain('1 source(s) disabled');
        expect(wrapper.text()).toContain('Show less');
        expect(wrapper.text()).not.toMatch(/[\u4e00-\u9fff]/);
        await wrapper.get('[data-testid="health-items-toggle"]').trigger('click');
        expect(wrapper.text()).not.toContain('Unnamed: low traffic');
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
