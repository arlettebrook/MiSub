import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, reactive, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from '../../src/i18n/index.js';

const controls = vi.hoisted(() => ({ logic: null, route: null }));
vi.mock('../../src/composables/useSettingsLogic.js', () => ({
    useSettingsLogic: () => controls.logic,
}));
vi.mock('vue-router', () => ({
    useRoute: () => controls.route,
}));

import SettingsView from '../../src/views/SettingsView.vue';

const storageKey = 'misub:settings-active-tab';
const tabs = [
    ['basic', '基础设置'],
    ['home', '首页设置'],
    ['custom-page', '自定义公开页'],
    ['global', '全局设置'],
    ['service', '服务集成'],
    ['client', '客户端管理'],
    ['system', '系统设置'],
];
const sectionStub = (tag) => ({ render: () => h(tag) });

describe('settings tab persistence', () => {
    let wrapper;

    beforeEach(() => {
        sessionStorage.clear();
        controls.route = reactive({ path: '/dashboard/settings' });
        controls.logic = {
            settings: ref({}),
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
    });

    afterEach(() => {
        wrapper?.unmount();
        vi.restoreAllMocks();
        sessionStorage.clear();
        document.body.innerHTML = '';
    });

    const mountPage = async () => {
        wrapper = mount(SettingsView, {
            attachTo: document.body,
            global: {
                plugins: [createI18n({ initialLocale: 'zh-CN' })],
                stubs: {
                    BasicSettings: sectionStub('basic-settings-stub'),
                    HomeSettings: sectionStub('home-settings-stub'),
                    GlobalSettings: sectionStub('global-settings-stub'),
                    ServiceSettings: sectionStub('service-settings-stub'),
                    ClientSettings: sectionStub('client-settings-stub'),
                    CustomPageSettings: sectionStub('custom-page-settings-stub'),
                    WebdavBackupSettings: sectionStub('webdav-backup-settings-stub'),
                    SystemSettings: sectionStub('system-settings-stub'),
                    MigrationModal: true,
                },
            },
        });
        await flushPromises();
    };

    const selectedTab = () => wrapper.find('.settings-page-layout aside button.bg-primary-600');
    const selectTab = async (label) => {
        const button = wrapper
            .findAll('.settings-page-layout aside button')
            .find((button) => button.text() === label);
        await button.trigger('click');
    };

    it('only mounts visited sections and preserves an existing section when switching back', async () => {
        await mountPage();
        expect(wrapper.find('basic-settings-stub').exists()).toBe(true);
        expect(wrapper.find('client-settings-stub').exists()).toBe(false);
        expect(wrapper.find('home-settings-stub').exists()).toBe(false);
        expect(wrapper.find('system-settings-stub').exists()).toBe(false);
        const basic = wrapper.get('basic-settings-stub').element;

        await selectTab('客户端管理');
        const client = wrapper.get('client-settings-stub').element;
        expect(basic.style.display).toBe('none');
        expect(wrapper.find('home-settings-stub').exists()).toBe(false);

        await selectTab('基础设置');
        expect(wrapper.get('basic-settings-stub').element).toBe(basic);
        expect(wrapper.get('client-settings-stub').element).toBe(client);
        expect(client.style.display).toBe('none');
        expect(controls.logic.loadSettings).toHaveBeenCalledOnce();
    });

    it('mounts only the restored section on initial entry', async () => {
        sessionStorage.setItem(storageKey, 'system');
        await mountPage();
        expect(wrapper.find('system-settings-stub').exists()).toBe(true);
        expect(wrapper.find('webdav-backup-settings-stub').exists()).toBe(true);
        expect(wrapper.find('basic-settings-stub').exists()).toBe(false);
        expect(wrapper.find('client-settings-stub').exists()).toBe(false);
    });

    it('does not mount a saved tab when a Token deep link selects Basic Settings', async () => {
        sessionStorage.setItem(storageKey, 'client');
        controls.route.query = { focus: 'mytoken' };
        await mountPage();
        expect(wrapper.find('basic-settings-stub').exists()).toBe(true);
        expect(wrapper.find('client-settings-stub').exists()).toBe(false);
    });

    it.each(tabs)('restores the %s tab after the settings page is recreated', async (id, label) => {
        await mountPage();
        if (id === 'basic') await selectTab('首页设置');
        await selectTab(label);
        expect(sessionStorage.getItem(storageKey)).toBe(id);
        wrapper.unmount();
        await mountPage();
        expect(selectedTab().text()).toBe(label);
    });

    it('defaults to Basic Settings when no tab has been saved or the saved tab is invalid', async () => {
        await mountPage();
        expect(selectedTab().text()).toBe('基础设置');
        wrapper.unmount();
        sessionStorage.setItem(storageKey, 'removed-tab');
        await mountPage();
        expect(selectedTab().text()).toBe('基础设置');
    });

    it('keeps the current tab when returning to the settings route', async () => {
        await mountPage();
        await selectTab('全局设置');
        controls.route.path = '/dashboard';
        await flushPromises();
        controls.route.path = '/dashboard/settings';
        await flushPromises();
        expect(selectedTab().text()).toBe('全局设置');
        expect(controls.logic.loadSettings).toHaveBeenCalledTimes(2);
    });

    it('allows tab switching when browser storage is blocked', async () => {
        vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
            throw new Error('Storage blocked');
        });
        vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
            throw new Error('Storage blocked');
        });
        await mountPage();
        expect(selectedTab().text()).toBe('基础设置');
        await selectTab('系统设置');
        expect(selectedTab().text()).toBe('系统设置');
    });
});
