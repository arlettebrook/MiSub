import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Dashboard from '../../src/components/features/Dashboard/Dashboard.vue';
import SavePrompt from '../../src/components/ui/SavePrompt.vue';
import ManualNodePanel from '../../src/components/nodes/ManualNodePanel.vue';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useSettingsStore } from '../../src/stores/settings.js';
import { useToastStore } from '../../src/stores/toast.js';
import { createI18n } from '../../src/i18n/index.js';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    api: { get: apiGet, post: apiPost },
}));

const modalStub = { render: () => null };

let wrapper;
beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
    apiGet.mockReset();
    apiPost.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useSettingsStore().updateConfig({ autoUpdateInterval: 0 });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
    sessionStorage.clear();
});

async function mountDashboard({ loaded = true } = {}) {
    const store = useDataStore();
    if (loaded) {
        store.hydrateFromData({ misubs: [], profiles: [], config: { autoUpdateInterval: 0 } });
    }
    wrapper = shallowMount(Dashboard, {
        global: {
            plugins: [createI18n({ initialLocale: 'zh-CN' })],
            // 显式组件替身避免 test-utils 的默认异步替身启动模块导入。
            stubs: {
                SettingsModal: modalStub,
                BulkImportModal: modalStub,
                ProfileModal: modalStub,
                SubscriptionImportModal: modalStub,
                LogModal: modalStub,
                NodePreviewModal: modalStub,
                BatchGroupModal: modalStub,
                GroupManagementModal: modalStub,
                QRCodeModal: modalStub,
                CopyLinkModal: modalStub,
            },
        },
    });
    await flushPromises();
    return store;
}

describe('dashboard data failures', () => {
    it('does not mount unused legacy dialogs or fetch logs when entering the dashboard', async () => {
        await mountDashboard();
        for (const name of [
            'LogModal',
            'NodePreviewModal',
            'QRCodeModal',
            'SettingsModal',
            'BulkImportModal',
            'SubscriptionImportModal',
            'BatchGroupModal',
            'GroupManagementModal',
        ]) {
            expect(wrapper.findComponent({ name }).exists()).toBe(false);
        }
        expect(apiGet).not.toHaveBeenCalled();
    });

    it('keeps legacy drafts and blocks saving or discarding during session verification', async () => {
        const store = await mountDashboard();
        store.markDirty();
        await wrapper.setProps({ sessionPaused: true });
        const prompt = wrapper.findComponent(SavePrompt);
        expect(prompt.props('disabled')).toBe(true);
        prompt.vm.$emit('save');
        prompt.vm.$emit('discard');
        await flushPromises();
        expect(apiPost).not.toHaveBeenCalled();
        expect(apiGet).not.toHaveBeenCalled();
        expect(store.isDirty).toBe(true);
        expect(prompt.props('saveState')).toBe('idle');
    });

    it('preserves unsaved changes when initialization fails', async () => {
        apiGet.mockRejectedValue(new Error('network down'));
        useDataStore().markDirty();
        const store = await mountDashboard({ loaded: false });
        expect(store.isDirty).toBe(true);
        expect(useToastStore().toasts).toHaveLength(1);
    });

    it('keeps the save prompt and sorting mode when saving fails', async () => {
        const store = await mountDashboard();
        store.markDirty();
        wrapper.findComponent(ManualNodePanel).vm.$emit('toggle-sort');
        apiPost.mockRejectedValue(new Error('save failed'));

        wrapper.findComponent(SavePrompt).vm.$emit('save');
        await flushPromises();

        const prompt = wrapper.findComponent(SavePrompt);
        expect(prompt.props('saveState')).toBe('idle');
        expect(prompt.props('isDirty')).toBe(true);
        expect(wrapper.findComponent(ManualNodePanel).props('isSorting')).toBe(true);
        expect(useToastStore().toasts).toHaveLength(1);
        expect(useToastStore().toasts[0].type).toBe('error');
    });

    it('does not announce discarded changes when reloading fails', async () => {
        const store = await mountDashboard();
        store.markDirty();
        apiGet.mockRejectedValue(new Error('network down'));
        wrapper.findComponent(SavePrompt).vm.$emit('discard');
        await flushPromises();

        expect(store.isDirty).toBe(true);
        expect(useToastStore().toasts).toHaveLength(1);
        expect(useToastStore().toasts[0].type).toBe('error');
    });

    it('shows success and exits sorting mode after saving succeeds', async () => {
        const store = await mountDashboard();
        store.markDirty();
        wrapper.findComponent(ManualNodePanel).vm.$emit('toggle-sort');
        apiPost.mockResolvedValue({ success: true });
        wrapper.findComponent(SavePrompt).vm.$emit('save');
        await flushPromises();

        expect(wrapper.findComponent(SavePrompt).props('saveState')).toBe('success');
        expect(store.isDirty).toBe(false);
        expect(wrapper.findComponent(ManualNodePanel).props('isSorting')).toBe(false);
    });
});
