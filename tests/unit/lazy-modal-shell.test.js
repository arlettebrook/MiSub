import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import Modal from '../../src/components/forms/Modal.vue';
import { createLazyModal } from '../../src/utils/lazy-modal.js';
import { useLazyModals } from '../../src/composables/useLazyModals.js';
import { createI18n } from '../../src/i18n/index.js';

const wrappers = [];
afterEach(async () => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    await nextTick();
    document.body.innerHTML = '';
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
        finish(ReadyDialog);
        await flushPromises();
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(document.querySelector('#ready-content')).not.toBeNull();
        expect(document.querySelector('[data-testid="modal-code-loading"]')).toBeNull();
        visible.value = false;
        await flushPromises();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.position).not.toBe('fixed');
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
