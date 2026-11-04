import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../../src/components/ui/ConfirmDialog.vue';
import Modal from '../../src/components/forms/Modal.vue';
import FormModal from '../../src/components/shared/FormModal.vue';
import {
    confirmAction,
    settleConfirm,
    useConfirm,
    useConfirmState,
} from '../../src/composables/useConfirm.js';
import { useSettingsLogic } from '../../src/composables/useSettingsLogic.js';
import { createI18n } from '../../src/i18n/index.js';

const mocks = vi.hoisted(() => ({ resetSettings: vi.fn(), showToast: vi.fn() }));
vi.mock('../../src/lib/api.js', () => ({
    fetchSettings: vi.fn(),
    saveSettings: vi.fn(),
    resetSettings: mocks.resetSettings,
}));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: mocks.showToast }),
}));
vi.mock('../../src/composables/useBackupLogic.js', () => ({
    useBackupLogic: () => ({ exportBackup: vi.fn(), importBackup: vi.fn() }),
}));

const wrappers = [];
const mountRoot = (component) => {
    const wrapper = mount(component, {
        attachTo: document.body,
        global: { plugins: [createI18n({ initialLocale: 'en-US' })] },
    });
    wrappers.push(wrapper);
    return wrapper;
};
const dialog = () =>
    Array.from(document.querySelectorAll('[role="dialog"]')).find(
        (element) => element.style.zIndex === 'var(--z-confirm)'
    );
const click = async (element) => {
    element.focus();
    element.click();
    await flushPromises();
};
const key = async (element, value, shiftKey = false) => {
    element.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
    );
    await flushPromises();
};

beforeEach(() => {
    mocks.resetSettings.mockReset().mockResolvedValue({ success: true });
    mocks.showToast.mockReset();
});
afterEach(async () => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    settleConfirm(false);
    await nextTick();
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('confirmation dialog integration', () => {
    it('keeps the second reset confirmation open and requires both approvals', async () => {
        vi.useFakeTimers();
        const root = defineComponent({
            setup() {
                const { handleReset } = useSettingsLogic();
                return () =>
                    h('div', [h('button', { onClick: handleReset }, 'Reset'), h(ConfirmDialog)]);
            },
        });
        const wrapper = mountRoot(root);
        await click(wrapper.get('button').element);
        const firstRequest = useConfirmState().value;
        expect(document.activeElement).toBe(dialog().querySelector('button'));
        await click(dialog().querySelectorAll('button')[1]);
        expect(useConfirmState().value.id).not.toBe(firstRequest.id);
        expect(mocks.resetSettings).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(dialog().querySelector('button'));
        firstRequest.listeners['update:show'](false);
        await flushPromises();
        expect(dialog()).toBeDefined();
        await click(dialog().querySelectorAll('button')[1]);
        expect(mocks.resetSettings).toHaveBeenCalledTimes(1);
        expect(useConfirmState().value).toBeNull();
    });

    it('cancels reset from the second confirmation without calling the API', async () => {
        const root = defineComponent({
            setup() {
                const { handleReset } = useSettingsLogic();
                return () =>
                    h('div', [h('button', { onClick: handleReset }, 'Reset'), h(ConfirmDialog)]);
            },
        });
        const wrapper = mountRoot(root);
        await click(wrapper.get('button').element);
        await click(dialog().querySelectorAll('button')[1]);
        await click(dialog().querySelector('button'));
        expect(mocks.resetSettings).not.toHaveBeenCalled();
        expect(useConfirmState().value).toBeNull();
        expect(document.activeElement).toBe(wrapper.get('button').element);
    });

    it.each([Modal, FormModal])(
        'dismisses only the top confirmation above a parent modal',
        async (ParentModal) => {
            const parentClose = vi.fn();
            const action = vi.fn();
            const root = defineComponent({
                setup() {
                    const { confirmAction: ask } = useConfirm();
                    const trigger = () =>
                        h(
                            'button',
                            {
                                id: 'parent-trigger',
                                onClick: async () => {
                                    if (await ask({ message: 'Delete?', variant: 'danger' }))
                                        action();
                                },
                            },
                            'Delete'
                        );
                    return () =>
                        h('div', [
                            h(
                                ParentModal,
                                {
                                    show: true,
                                    ...(ParentModal === FormModal ? { title: 'Parent' } : {}),
                                    'onUpdate:show': parentClose,
                                },
                                ParentModal === Modal ? { body: trigger } : { default: trigger }
                            ),
                            h(ConfirmDialog),
                        ]);
                },
            });
            mountRoot(root);
            await flushPromises();
            await click(document.getElementById('parent-trigger'));
            const top = dialog();
            expect(
                document.getElementById(top.getAttribute('aria-describedby')).textContent
            ).toContain('Delete?');
            const buttons = top.querySelectorAll('button');
            expect(buttons[1].classList.contains('bg-red-600')).toBe(true);
            expect(document.activeElement).toBe(buttons[0]);
            await key(buttons[0], 'Tab', true);
            expect(document.activeElement).toBe(buttons[1]);
            await key(buttons[1], 'Tab');
            expect(document.activeElement).toBe(buttons[0]);
            await key(buttons[0], 'Escape');
            expect(parentClose).not.toHaveBeenCalled();
            expect(action).not.toHaveBeenCalled();
            expect(useConfirmState().value).toBeNull();
            expect(document.activeElement).toBe(document.getElementById('parent-trigger'));
            expect(document.querySelector('[role="dialog"]').getAttribute('aria-modal')).toBe(
                'true'
            );
        }
    );

    it('keeps a confirmation above a parent that opens later', async () => {
        const showParent = ref(false);
        const root = defineComponent({
            setup: () => () =>
                h('div', [
                    h(
                        FormModal,
                        { show: showParent.value, title: 'Later parent' },
                        { default: () => h('input') }
                    ),
                    h(ConfirmDialog),
                ]),
        });
        mountRoot(root);
        const result = confirmAction({ message: 'Continue?' });
        await flushPromises();
        const cancel = dialog().querySelector('button');
        showParent.value = true;
        await flushPromises();
        expect(document.activeElement).toBe(cancel);
        await key(cancel, 'Escape');
        await expect(result).resolves.toBe(false);
        expect(document.querySelector('[role="dialog"]').getAttribute('aria-modal')).toBe('true');
    });

    it('cancels a confirmation when its caller component unmounts', async () => {
        const showCaller = ref(true);
        const action = vi.fn();
        const Caller = defineComponent({
            setup() {
                const { confirmAction: ask } = useConfirm();
                return () =>
                    h(
                        'button',
                        {
                            onClick: async () => {
                                if (await ask({ message: 'Restore?' })) action();
                            },
                        },
                        'Restore'
                    );
            },
        });
        const root = defineComponent({
            setup: () => () => h('div', [showCaller.value ? h(Caller) : null, h(ConfirmDialog)]),
        });
        const wrapper = mountRoot(root);
        await click(wrapper.get('button').element);
        const previous = useConfirmState().value;
        showCaller.value = false;
        await flushPromises();
        previous.listeners.confirm();
        expect(action).not.toHaveBeenCalled();
        expect(useConfirmState().value).toBeNull();
    });
});
