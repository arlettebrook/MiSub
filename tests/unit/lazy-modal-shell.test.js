import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import Modal from '../../src/components/forms/Modal.vue';
import { createLazyModal } from '../../src/utils/lazy-modal.js';
import { useLazyModals } from '../../src/composables/useLazyModals.js';
import { createI18n } from '../../src/i18n/index.js';
import { cachedLoader } from '../../src/utils/load-timing.js';

const wrappers = [];
afterEach(async () => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    await nextTick();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

function host(loader, attributes = {}) {
    const visible = ref(false);
    const Dialog = createLazyModal('NodePreviewModal', loader);
    const Root = defineComponent({
        setup() {
            const requested = useLazyModals({ dialog: visible });
            return () =>
                h('main', [
                    h(
                        'button',
                        { id: 'open-dialog', onClick: () => (visible.value = true) },
                        'Open'
                    ),
                    requested.has('dialog') &&
                        h(Dialog, {
                            ...attributes,
                            show: visible.value,
                            'onUpdate:show': (value) => (visible.value = value),
                        }),
                ]);
        },
    });
    const wrapper = mount(Root, {
        attachTo: document.body,
        global: { plugins: [createI18n({ initialLocale: 'en-US' })] },
    });
    wrappers.push(wrapper);
    return { wrapper, visible };
}

const ReadyDialog = defineComponent({
    inheritAttrs: false,
    props: { show: Boolean, profileName: String },
    emits: ['update:show'],
    setup(props, { emit }) {
        return () =>
            h(
                Modal,
                { show: props.show, 'onUpdate:show': (value) => emit('update:show', value) },
                {
                    title: () => 'Ready dialog',
                    body: () => h('div', { id: 'ready-content' }, 'Loaded'),
                    footer: () =>
                        h('button', { onClick: () => emit('update:show', false) }, 'Close loaded'),
                }
            );
    },
});

describe('immediate lazy dialog shell', () => {
    it('shows the title and close control while code is pending and restores focus after replacement', async () => {
        let finish;
        const loader = vi.fn(() => new Promise((resolve) => (finish = resolve)));
        const { wrapper, visible } = host(loader, { 'profile-name': 'Daily profile' });
        expect(loader).not.toHaveBeenCalled();
        const trigger = wrapper.get('#open-dialog').element;
        trigger.focus();
        await wrapper.get('#open-dialog').trigger('click');
        expect(document.querySelector('[role="dialog"]').textContent).toContain('Daily profile');
        expect(document.querySelector('[data-testid="modal-code-loading"]')).not.toBeNull();
        expect(document.body.style.position).toBe('fixed');
        expect(document.querySelector('button[aria-label="Close"]')).not.toBeNull();
        const backdrop = document.querySelector('[role="dialog"]');
        const panel = backdrop.querySelector('[tabindex="-1"]');
        const titleId = backdrop.getAttribute('aria-labelledby');
        finish(ReadyDialog);
        await flushPromises();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(document.querySelector('#ready-content')).not.toBeNull();
        expect(document.querySelector('[data-testid="modal-code-loading"]')).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBe(backdrop);
        expect(backdrop.querySelector('[tabindex="-1"]')).toBe(panel);
        expect(backdrop.getAttribute('aria-labelledby')).toBe(titleId);
        visible.value = false;
        await flushPromises();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.position).not.toBe('fixed');
    });

    it('opens the shell immediately but waits 150ms to show the loading animation', async () => {
        vi.useFakeTimers();
        let finish;
        const { wrapper } = host(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.get('#open-dialog').trigger('click');
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.querySelector('.loading-orbit')).toBeNull();
        await vi.advanceTimersByTimeAsync(149);
        expect(document.querySelector('.loading-orbit')).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(document.querySelector('.loading-orbit')).not.toBeNull();
        finish(ReadyDialog);
        await flushPromises();
        expect(document.querySelector('.loading-orbit')).toBeNull();
    });

    it('never shows the indicator for a fast load or a module preloaded during idle time', async () => {
        vi.useFakeTimers();
        const shared = cachedLoader(
            'test:preloaded-dialog',
            vi.fn(async () => ({ default: ReadyDialog }))
        );
        await shared();
        const { wrapper } = host(shared);
        await wrapper.get('#open-dialog').trigger('click');
        await flushPromises();
        expect(document.querySelector('#ready-content')).not.toBeNull();
        expect(document.querySelector('[data-testid="modal-code-loading"]')).toBeNull();
        await vi.advanceTimersByTimeAsync(200);
        expect(document.querySelector('.loading-orbit')).toBeNull();
    });

    it('removes the delayed indicator when an uncached load resolves within 150ms', async () => {
        vi.useFakeTimers();
        let finish;
        const { wrapper } = host(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.get('#open-dialog').trigger('click');
        await vi.advanceTimersByTimeAsync(80);
        expect(document.querySelector('.loading-orbit')).toBeNull();
        finish(ReadyDialog);
        await flushPromises();
        expect(document.querySelector('#ready-content')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(200);
        expect(document.querySelector('.loading-orbit')).toBeNull();
    });

    it('forwards live validation, confirmation and slot updates without remounting the shell', async () => {
        const disabled = ref(true);
        const label = ref('Save changes');
        const saved = vi.fn();
        const Editor = defineComponent({
            inheritAttrs: false,
            props: { show: Boolean },
            setup(props) {
                return () =>
                    h(
                        Modal,
                        {
                            show: props.show,
                            confirmDisabled: disabled.value,
                            confirmText: label.value,
                            closeOnConfirm: false,
                            onConfirm: saved,
                        },
                        { body: () => h('input', { id: 'draft', value: 'Draft' }) }
                    );
            },
        });
        const { wrapper } = host(async () => Editor);
        await wrapper.get('#open-dialog').trigger('click');
        await flushPromises();
        const panel = document.querySelector('[tabindex="-1"]');
        const input = document.querySelector('#draft');
        input.focus();
        const findSave = () =>
            [...document.querySelectorAll('button')].find(
                (button) => button.textContent.trim() === label.value
            );
        expect(findSave().disabled).toBe(true);
        disabled.value = false;
        label.value = 'Save now';
        await flushPromises();
        expect(findSave().disabled).toBe(false);
        expect(document.querySelector('[tabindex="-1"]')).toBe(panel);
        expect(document.querySelector('#draft')).toBe(input);
        expect(document.activeElement).toBe(input);
        findSave().click();
        await flushPromises();
        expect(saved).toHaveBeenCalledOnce();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('keeps nested dialogs on a separate layer', async () => {
        const nested = ref(false);
        const Editor = defineComponent({
            inheritAttrs: false,
            props: { show: Boolean },
            setup(props) {
                return () =>
                    h(
                        Modal,
                        { show: props.show },
                        {
                            body: () => [
                                h('button', { id: 'unrelated' }, 'Other'),
                                h(
                                    'button',
                                    { id: 'open-nested', onClick: () => (nested.value = true) },
                                    'Nested'
                                ),
                                h(
                                    Modal,
                                    {
                                        show: nested.value,
                                        'onUpdate:show': (value) => (nested.value = value),
                                    },
                                    { body: () => 'Nested body' }
                                ),
                            ],
                        }
                    );
            },
        });
        const { wrapper } = host(async () => Editor);
        await wrapper.get('#open-dialog').trigger('click');
        await flushPromises();
        const outer = document.querySelector('[role="dialog"]');
        document.querySelector('#open-nested').focus();
        document.querySelector('#open-nested').click();
        await flushPromises();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
        expect(outer.getAttribute('aria-hidden')).toBe('true');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flushPromises();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(document.querySelector('[role="dialog"]')).toBe(outer);
        expect(document.activeElement.id).toBe('open-nested');
    });

    it('closes with Escape before the code arrives and does not open again when it finishes', async () => {
        let finish;
        const { wrapper, visible } = host(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.get('#open-dialog').trigger('click');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nextTick();
        expect(visible.value).toBe(false);
        finish(ReadyDialog);
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps a failed load closable and retries on demand', async () => {
        const loader = vi
            .fn()
            .mockRejectedValueOnce(new Error('Offline'))
            .mockResolvedValue(ReadyDialog);
        const { wrapper } = host(loader);
        await wrapper.get('#open-dialog').trigger('click');
        await flushPromises();
        expect(document.querySelector('[role="alert"]').textContent).toContain(
            'could not be loaded'
        );
        const retry = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Retry'
        );
        retry.click();
        await flushPromises();
        expect(loader).toHaveBeenCalledTimes(2);
        expect(document.querySelector('#ready-content')).not.toBeNull();
    });
});
