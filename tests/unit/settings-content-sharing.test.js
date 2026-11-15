import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from '../../src/i18n/index.js';
import SettingsContent from '../../src/components/settings/SettingsContent.vue';
import SettingsView from '../../src/views/SettingsView.vue';
import SettingsPanel from '../../src/components/modals/SettingsPanel.vue';
import SettingsModal from '../../src/components/modals/SettingsModal.vue';
import { readFileSync } from 'node:fs';

const controls = vi.hoisted(() => ({ logic: vi.fn(), instances: [] }));
vi.mock('../../src/composables/useSettingsLogic.js', () => ({
    useSettingsLogic: (...args) => controls.logic(...args),
}));
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/dashboard/settings', query: {} }) }));
enableAutoUnmount(afterEach);
const Section = {
    props: ['settings'],
    template: '<input class="setting-edit" v-model="settings.FileName" />',
};
const stubs = {
    Teleport: true,
    BasicSettings: Section,
    HomeSettings: true,
    GlobalSettings: true,
    ServiceSettings: true,
    ClientSettings: true,
    CustomPageSettings: { name: 'CustomPageSettings', props: ['settings'], template: '<div />' },
    WebdavBackupSettings: true,
    SystemSettings: {
        name: 'SystemSettings',
        props: ['settings', 'exportBackup', 'importBackup', 'handleReset'],
        emits: ['migrate'],
        template: '<div />',
    },
    MigrationModal: true,
};
function options(props = {}) {
    return { props, global: { plugins: [createI18n({ initialLocale: 'en-US' })], stubs } };
}
function state() {
    const settings = ref({ FileName: 'Original', storageType: 'kv' });
    return {
        settings,
        disguiseConfig: ref({}),
        isLoading: ref(false),
        isSaving: ref(false),
        hasUnsavedChanges: computed(() => settings.value.FileName !== 'Original'),
        showMigrationModal: ref(false),
        hasWhitespace: ref(false),
        isStorageTypeValid: ref(true),
        loadSettings: vi.fn(async () => {}),
        handleSave: vi.fn(async () => true),
        handleMigrationSuccess: vi.fn(),
        handleReset: vi.fn(),
        exportBackup: vi.fn(),
        importBackup: vi.fn(),
    };
}
beforeEach(() => {
    sessionStorage.clear();
    controls.instances.length = 0;
    controls.logic.mockReset().mockImplementation(() => {
        const logic = state();
        controls.instances.push(logic);
        return logic;
    });
});
afterEach(() => vi.restoreAllMocks());
async function tab(wrapper, name) {
    await wrapper
        .findAll('aside button')
        .find((button) => button.text() === name)
        .trigger('click');
    await flushPromises();
}
describe('shared SettingsContent', () => {
    it.each([SettingsView, SettingsPanel])(
        'uses the parent state and one settings load in each shell',
        async (shell) => {
            const wrapper = mount(shell, options());
            await flushPromises();
            expect(controls.logic).toHaveBeenCalledTimes(1);
            const logic = controls.instances[0];
            expect(logic.loadSettings).toHaveBeenCalledTimes(1);
            expect(wrapper.findComponent(SettingsContent).props('settings')).toBe(
                logic.settings.value
            );
            await wrapper.get('input.setting-edit').setValue('Edited');
            expect(logic.settings.value.FileName).toBe('Edited');
            expect(logic.hasUnsavedChanges.value).toBe(true);
            await wrapper.get('.settings-layout-footer button').trigger('click');
            expect(logic.handleSave).toHaveBeenCalledTimes(1);
        }
    );
    it('keeps separately opened page and panel drafts independent', async () => {
        const page = mount(SettingsView, options());
        const panel = mount(SettingsPanel, options());
        await flushPromises();
        await page.get('input.setting-edit').setValue('Page draft');
        expect(panel.get('input.setting-edit').element.value).toBe('Original');
        expect(controls.logic).toHaveBeenCalledTimes(2);
    });
    it.each([SettingsView, SettingsPanel])(
        'renders Custom Page and passes all System actions in each shell',
        async (shell) => {
            const wrapper = mount(shell, options());
            await flushPromises();
            const logic = controls.instances[0];
            await tab(wrapper, 'Public Page');
            expect(wrapper.findComponent({ name: 'CustomPageSettings' }).exists()).toBe(true);
            expect(wrapper.findComponent({ name: 'CustomPageSettings' }).props('settings')).toBe(
                logic.settings.value
            );
            await tab(wrapper, 'System');
            const system = wrapper.findComponent({ name: 'SystemSettings' });
            expect(system.props('handleReset')).toBe(logic.handleReset);
            expect(system.props('exportBackup')).toBe(logic.exportBackup);
            expect(system.props('importBackup')).toBe(logic.importBackup);
            system.vm.$emit('migrate');
            await flushPromises();
            expect(logic.showMigrationModal.value).toBe(true);
        }
    );
    it('supports explicit panel backup callbacks and does not discard the reset callback', async () => {
        const exportBackup = vi.fn(),
            importBackup = vi.fn();
        const wrapper = mount(SettingsPanel, options({ exportBackup, importBackup }));
        await flushPromises();
        await tab(wrapper, 'System');
        const system = wrapper.findComponent({ name: 'SystemSettings' });
        expect(system.props('exportBackup')).toBe(exportBackup);
        expect(system.props('importBackup')).toBe(importBackup);
        expect(system.props('handleReset')).toBe(controls.instances[0].handleReset);
    });
    it('keeps visited panel sections alive while leaving unused sections unmounted', async () => {
        const wrapper = mount(SettingsPanel, options());
        await flushPromises();
        const basic = wrapper.get('input.setting-edit').element;
        expect(wrapper.findComponent({ name: 'CustomPageSettings' }).exists()).toBe(false);
        await tab(wrapper, 'Public Page');
        expect(wrapper.get('input.setting-edit').element).toBe(basic);
        expect(basic.style.display).toBe('none');
        await tab(wrapper, 'Basic');
        expect(wrapper.get('input.setting-edit').element).toBe(basic);
    });
    it('shows the module header on the panel and shares the loading indicator', async () => {
        const wrapper = mount(SettingsPanel, options());
        await flushPromises();
        expect(wrapper.text()).toContain('Module');
        expect(wrapper.findComponent(SettingsContent).props('alwaysShowHeader')).toBe(true);
        controls.instances[0].isLoading.value = true;
        await flushPromises();
        expect(wrapper.get('[role="status"]').text()).toContain('Loading');
        expect(wrapper.get('[role="status"] svg.animate-spin').exists()).toBe(true);
        expect(wrapper.get('.settings-layout-footer button').element.disabled).toBe(true);
    });
    it.each(['isLoading', 'isSaving', 'hasWhitespace'])(
        'blocks both exposed and button panel saves while %s',
        async (key) => {
            const wrapper = mount(SettingsPanel, options());
            await flushPromises();
            const logic = controls.instances[0];
            logic[key].value = true;
            await flushPromises();
            expect(await wrapper.vm.handleSave()).toBe(false);
            expect(logic.handleSave).not.toHaveBeenCalled();
            expect(wrapper.get('.settings-layout-footer button').element.disabled).toBe(true);
        }
    );
    it('blocks panel confirmation during session verification and keeps drafts', async () => {
        const wrapper = mount(SettingsPanel, options());
        await flushPromises();
        await wrapper.get('input.setting-edit').setValue('Draft');
        await wrapper.setProps({ sessionPaused: true });
        expect(await wrapper.vm.handleSave()).toBe(false);
        expect(controls.instances[0].settings.value.FileName).toBe('Draft');
        await wrapper.setProps({ sessionPaused: false });
        expect(await wrapper.vm.handleSave()).toBe(true);
    });
    it('closes SettingsModal only after the panel reports a successful save', async () => {
        const wrapper = mount(SettingsModal, options({ show: true }));
        await flushPromises();
        const logic = controls.instances[0];
        logic.handleSave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await wrapper.vm.handleConfirm();
        expect(wrapper.emitted('update:show')).toBeUndefined();
        await wrapper.vm.handleConfirm();
        expect(wrapper.emitted('update:show')).toEqual([[false]]);
    });
    it('containers do not import settings sections or create a second content implementation', () => {
        for (const filename of [
            'src/views/SettingsView.vue',
            'src/components/modals/SettingsPanel.vue',
        ]) {
            const source = readFileSync(filename, 'utf8');
            expect(source).toContain('<SettingsContent');
            expect(source).not.toMatch(
                /sections\/|defineAsyncComponent|<BasicSettings|<SystemSettings/
            );
        }
        const shared = readFileSync('src/components/settings/SettingsContent.vue', 'utf8');
        expect(shared).not.toContain('useSettingsLogic(');
        expect(shared).toContain('settingsSectionLoaders');
    });
});
