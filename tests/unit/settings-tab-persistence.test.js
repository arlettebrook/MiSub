import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
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
                    BasicSettings: true,
                    HomeSettings: true,
                    GlobalSettings: true,
                    ServiceSettings: true,
                    ClientSettings: true,
                    CustomPageSettings: true,
                    WebdavBackupSettings: true,
                    SystemSettings: true,
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
