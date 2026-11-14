import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createI18n } from '../../src/i18n/index.js';
import { createLazyModal } from '../../src/utils/lazy-modal.js';
import { useLazyModals } from '../../src/composables/useLazyModals.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useSettingsStore } from '../../src/stores/settings.js';
import LogModal from '../../src/components/modals/LogModal.vue';
import NodePreviewModal from '../../src/components/modals/NodePreview/NodePreviewModal.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    api: { get: mocks.get, post: mocks.post, del: mocks.del },
}));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast: mocks.toast }) }));
vi.mock('../../src/composables/useConfirm.js', () => ({
    useConfirm: () => ({ confirmAction: async () => true }),
}));

const wrappers = [];
const logs = (name = 'Daily') => ({
    success: true,
    data: [{ id: 'log', profileName: name, timestamp: 1, userAgent: '', status: 'success' }],
});
const nodes = (name = 'Daily node') => ({
    success: true,
    nodes: [
        {
            name,
            url: 'vless://demo@example.com:443#Demo',
            protocol: 'vless',
            server: 'example.com',
            port: 443,
        },
    ],
    stats: {},
});
beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(logs());
    mocks.post.mockReset().mockResolvedValue(nodes());
    mocks.del.mockReset().mockResolvedValue({ success: true });
    mocks.toast.mockClear();
});
afterEach(async () => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    await flushPromises();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function host(name, initial = {}) {
    const visible = ref(false);
    const source = reactive(initial);
    const pinia = createPinia();
    let finishCode;
    const loader = vi.fn(() => new Promise((resolve) => (finishCode = resolve)));
    const Dialog = createLazyModal(name, loader);
    const wrapper = mount(
        defineComponent({
            setup() {
                const requested = useLazyModals({ dialog: visible });
                return () =>
                    h(
                        'main',
                        requested.has('dialog')
                            ? h(Dialog, {
                                  ...source,
                                  show: visible.value,
                                  'onUpdate:show': (value) => (visible.value = value),
                              })
                            : null
                    );
            },
        }),
        {
            attachTo: document.body,
            global: { plugins: [pinia, createI18n({ initialLocale: 'en-US' })] },
        }
    );
    wrappers.push(wrapper);
    return {
        wrapper,
        visible,
        source,
        pinia,
        loader,
        finishCode: () => finishCode(name === 'LogModal' ? LogModal : NodePreviewModal),
    };
}

describe('dialog code and data load together', () => {
    it.each(['LogModal', 'NodePreviewModal'])(
        'starts %s data before the component code arrives and adopts it without a duplicate request',
        async (name) => {
            const { visible, loader, finishCode } = host(
                name,
                name === 'NodePreviewModal' ? { subscriptionId: 'source-1' } : {}
            );
            const request = name === 'LogModal' ? mocks.get : mocks.post;
            expect(request).not.toHaveBeenCalled();
            visible.value = true;
            await flushPromises();
            expect(loader).toHaveBeenCalledOnce();
            expect(request).toHaveBeenCalledOnce();
            expect(document.querySelector('[data-testid="modal-code-loading"]')).not.toBeNull();
            finishCode();
            await flushPromises();
            expect(document.body.textContent).toContain(
                name === 'LogModal' ? 'Daily' : 'Daily node'
            );
            expect(request).toHaveBeenCalledOnce();
            expect(document.querySelector('[data-testid="modal-code-loading"]')).toBeNull();
        }
    );

    it('cancels data during code loading, and a late response cannot populate the next opening', async () => {
        let finishOld;
        mocks.get.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
        const { visible, finishCode } = host('LogModal');
        visible.value = true;
        await nextTick();
        const signal = mocks.get.mock.calls[0][1].signal;
        visible.value = false;
        await nextTick();
        expect(signal.aborted).toBe(true);
        finishOld(logs('Obsolete'));
        finishCode();
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledOnce();
        visible.value = true;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledTimes(2);
        expect(document.body.textContent).toContain('Daily');
        expect(document.body.textContent).not.toContain('Obsolete');
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('replaces the pending request when the source changes during code loading', async () => {
        let finishOld;
        mocks.post.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
        const { visible, source, finishCode } = host('NodePreviewModal', {
            subscriptionId: 'first',
        });
        visible.value = true;
        await nextTick();
        source.subscriptionId = 'second';
        await flushPromises();
        expect(mocks.post.mock.calls[0][2].signal.aborted).toBe(true);
        expect(mocks.post.mock.calls[1][1].subscriptionId).toBe('second');
        finishCode();
        finishOld(nodes('Obsolete'));
        await flushPromises();
        expect(mocks.post).toHaveBeenCalledTimes(2);
        expect(document.body.textContent).toContain('Daily node');
        expect(document.body.textContent).not.toContain('Obsolete');
    });

    it('shows a prefetch failure once without retrying automatically, then allows manual retry', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Offline'));
        const { wrapper, visible, finishCode } = host('LogModal');
        visible.value = true;
        await flushPromises();
        finishCode();
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledOnce();
        expect(mocks.toast).toHaveBeenCalledOnce();
        await wrapper.findComponent(LogModal).vm.fetchLogs();
        expect(mocks.get).toHaveBeenCalledTimes(2);
        expect(document.body.textContent).toContain('Daily');
    });
});

describe('short lived dialog data', () => {
    it.each(['LogModal', 'NodePreviewModal'])(
        'reuses %s data, but refreshes after TTL, edits, settings changes and session reset',
        async (name) => {
            const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
            const { visible, pinia, finishCode } = host(
                name,
                name === 'NodePreviewModal' ? { subscriptionId: 'source-1' } : {}
            );
            const request = name === 'LogModal' ? mocks.get : mocks.post;
            const reopen = async () => {
                visible.value = false;
                await nextTick();
                visible.value = true;
                await flushPromises();
            };
            visible.value = true;
            await flushPromises();
            finishCode();
            await flushPromises();
            await reopen();
            expect(request).toHaveBeenCalledOnce();
            clock.mockReturnValue(32_000);
            await reopen();
            expect(request).toHaveBeenCalledTimes(2);
            visible.value = false;
            await nextTick();
            useDataStore(pinia).markDirty();
            visible.value = true;
            await flushPromises();
            expect(request).toHaveBeenCalledTimes(3);
            visible.value = false;
            await nextTick();
            useSettingsStore(pinia).updateConfig({ FileName: 'changed' });
            visible.value = true;
            await flushPromises();
            expect(request).toHaveBeenCalledTimes(4);
            visible.value = false;
            await nextTick();
            useDataStore(pinia).resetSessionData();
            visible.value = true;
            await flushPromises();
            expect(request).toHaveBeenCalledTimes(5);
        }
    );

    it('reuses processed profile nodes, but a transform change and manual refresh fetch new results', async () => {
        const { wrapper, visible, finishCode } = host('NodePreviewModal', {
            profileId: 'profile-1',
        });
        visible.value = true;
        await flushPromises();
        finishCode();
        await flushPromises();
        const preview = wrapper.findComponent(NodePreviewModal);
        preview.vm.showProcessed = false;
        await flushPromises();
        expect(mocks.post.mock.calls.at(-1)[1].applyTransform).toBe(false);
        expect(mocks.post).toHaveBeenCalledTimes(2);
        visible.value = false;
        await nextTick();
        visible.value = true;
        await flushPromises();
        expect(mocks.post).toHaveBeenCalledTimes(2);
        await preview.vm.loadNodes(true);
        expect(mocks.post).toHaveBeenCalledTimes(3);
        expect(mocks.post.mock.calls.at(-1)[1].forceRefresh).toBe(true);
    });

    it('invalidates the log result after clearing it', async () => {
        const { wrapper, visible, finishCode } = host('LogModal');
        visible.value = true;
        await flushPromises();
        finishCode();
        await flushPromises();
        await wrapper.findComponent(LogModal).vm.clearLogs();
        expect(mocks.del).toHaveBeenCalledWith('/api/logs');
        visible.value = false;
        await nextTick();
        visible.value = true;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledTimes(2);
    });
});
