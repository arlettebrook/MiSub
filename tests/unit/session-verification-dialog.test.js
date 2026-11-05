import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import SessionVerification from '../../src/components/ui/SessionVerification.vue';
import Modal from '../../src/components/forms/Modal.vue';
import { createI18n } from '../../src/i18n/index.js';

const wrappers = [];
const mountDialog = (component, props, locale = 'zh-CN') => {
    const wrapper = mount(component, {
        props,
        attachTo: document.body,
        global: { plugins: [createI18n({ initialLocale: locale })] },
    });
    wrappers.push(wrapper);
    return wrapper;
};

afterEach(() => {
    wrappers
        .splice(0)
        .reverse()
        .forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = '';
    document.body.style.overflow = '';
});

describe('blocking session verification dialog', () => {
    it('traps keyboard focus, ignores dismissal, and restores focus and scrolling on recovery', async () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        document.body.style.overflow = 'auto';
        const wrapper = mountDialog(SessionVerification, { show: false, reason: 'connection' });
        await wrapper.setProps({ show: true });
        await nextTick();

        const backdrop = document.querySelector('[data-testid="session-verification"]');
        const dialog = backdrop.querySelector('[role="dialog"]');
        const retry = dialog.querySelector('button');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(retry);
        expect(document.body.style.overflow).toBe('hidden');
        expect(
            document.getElementById(dialog.getAttribute('aria-describedby')).textContent
        ).toContain('验证成功后才能继续使用');

        const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        window.dispatchEvent(escape);
        backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        backdrop.click();
        await nextTick();
        expect(escape.defaultPrevented).toBe(true);
        expect(document.body.contains(dialog)).toBe(true);
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(wrapper.emitted('update:show')).toBeUndefined();

        const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
        window.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(retry);

        await wrapper.setProps({ show: false });
        await nextTick();
        expect(document.querySelector('[data-testid="session-verification"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.overflow).toBe('auto');
    });

    it('keeps existing and newly opened confirmation dialogs blocked until verification succeeds', async () => {
        const existing = mountDialog(Modal, { show: true, layer: 'confirmation' });
        const verification = mountDialog(SessionVerification, { show: true, reason: 'connection' });
        const latest = mountDialog(Modal, { show: true, layer: 'confirmation' });
        await nextTick();

        const underlying = [...document.querySelectorAll('[role="dialog"]')].filter(
            (dialog) => !dialog.closest('[data-testid="session-verification"]')
        );
        expect(underlying).toHaveLength(2);
        underlying.forEach((dialog) => {
            expect(dialog.hasAttribute('inert')).toBe(true);
            expect(dialog.getAttribute('aria-hidden')).toBe('true');
        });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        expect(existing.emitted('update:show')).toBeUndefined();
        expect(latest.emitted('update:show')).toBeUndefined();

        await verification.setProps({ show: false });
        await nextTick();
        expect(underlying[1].hasAttribute('inert')).toBe(false);
        expect(underlying[1].getAttribute('aria-modal')).toBe('true');
        expect(underlying[1].contains(document.activeElement)).toBe(true);
    });

    it.each(['zh-CN', 'en-US'])(
        'allows retry without dismissing and blocks retries while busy (%s)',
        async (locale) => {
            const wrapper = mountDialog(
                SessionVerification,
                { show: true, reason: 'connection' },
                locale
            );
            await nextTick();
            const dialog = document.querySelector('[data-testid="session-verification"]');
            const retry = dialog.querySelector('button');
            expect(dialog.textContent).not.toMatch(/继续编辑|continue editing/i);
            retry.click();
            expect(wrapper.emitted('retry')).toHaveLength(1);
            expect(document.body.contains(dialog)).toBe(true);

            await wrapper.setProps({ busy: true });
            expect(retry.disabled).toBe(true);
            expect(dialog.querySelector('[role="dialog"]').getAttribute('aria-busy')).toBe('true');
            retry.click();
            expect(wrapper.emitted('retry')).toHaveLength(1);
            wrapper.unmount();
            expect(document.body.style.overflow).toBe('');
        }
    );
});
