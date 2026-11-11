import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import AdvancedOptions from '../../src/components/modals/SubscriptionEditModal/AdvancedOptions.vue';
import { createI18n } from '../../src/i18n/index.js';
import { DEFAULT_USER_AGENT, USER_AGENT_PRESETS } from '../../shared/user-agents.js';

const mounted = [];

function mountEditor(subscription = {}) {
    const editingSubscription = reactive({ ...subscription });
    const wrapper = mount(AdvancedOptions, {
        props: { editingSubscription },
        attachTo: document.body,
        global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] },
    });
    mounted.push(wrapper);
    return { wrapper, editingSubscription, input: wrapper.get('#sub-edit-ua') };
}

async function openPresets(wrapper) {
    await wrapper.get('button[aria-haspopup="listbox"]').trigger('click');
    await nextTick();
}

afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('editable subscription UA', () => {
    it.each([
        {},
        { customUserAgent: undefined },
        { customUserAgent: null },
        { customUserAgent: '' },
        { customUserAgent: '   ' },
    ])('shows the default for an unset UA without changing stored data (%j)', (subscription) => {
        const { wrapper, editingSubscription, input } = mountEditor(subscription);
        expect(input.element.value).toBe('');
        expect(input.attributes('placeholder')).toBe('使用默认 UA');
        expect(wrapper.get('#sub-edit-ua-current').text()).toBe(`默认 UA: ${DEFAULT_USER_AGENT}`);
        expect(editingSubscription).toEqual(subscription);
        expect(wrapper.text()).not.toContain('留空使用默认');
    });

    it.each(['clash-verge/v2.4.3', 'CustomClient/42 (Android; test)', '  CustomClient/1.0  '])(
        'displays an existing UA verbatim without upgrading it (%s)',
        (customUserAgent) => {
            const { editingSubscription, input } = mountEditor({ customUserAgent });
            expect(input.element.value).toBe(customUserAgent);
            expect(editingSubscription.customUserAgent).toBe(customUserAgent);
        }
    );

    it('saves typed UA text exactly and supports returning to the default', async () => {
        const { wrapper, editingSubscription, input } = mountEditor({
            customUserAgent: 'clash-verge/v2.4.3',
        });
        await input.setValue('MyClient/3.4 (custom)');
        expect(editingSubscription.customUserAgent).toBe('MyClient/3.4 (custom)');
        expect(wrapper.get('#sub-edit-ua-current').text()).toBe('自定义 UA: MyClient/3.4 (custom)');
        await openPresets(wrapper);
        const defaultOption = document.querySelector('[role="option"]');
        expect(defaultOption.textContent).toContain('使用默认 UA');
        defaultOption.click();
        await nextTick();
        expect(editingSubscription.customUserAgent).toBe('');
        expect(input.element.value).toBe('');
        expect(wrapper.get('#sub-edit-ua-current').text()).toBe(`默认 UA: ${DEFAULT_USER_AGENT}`);
    });

    it('updates an existing UA only after selecting a preset', async () => {
        const { wrapper, editingSubscription, input } = mountEditor({
            customUserAgent: 'clash-verge/v2.4.3',
        });
        await openPresets(wrapper);
        expect(input.element.value).toBe('clash-verge/v2.4.3');
        expect(editingSubscription.customUserAgent).toBe('clash-verge/v2.4.3');
        const option = [...document.querySelectorAll('[role="option"]')].find((item) =>
            item.textContent.includes('v2rayN/7.25.6')
        );
        option.click();
        await nextTick();
        expect(input.element.value).toBe('v2rayN/7.25.6');
        expect(editingSubscription.customUserAgent).toBe('v2rayN/7.25.6');
        expect(wrapper.get('#sub-edit-ua-current').text()).toBe('预设 UA: v2rayN/7.25.6');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
    });

    it('supports keyboard selection and closes Escape without changing a custom UA', async () => {
        const { editingSubscription, input } = mountEditor({
            customUserAgent: 'clash-verge/v2.4.3',
        });
        await input.trigger('keydown', { key: 'ArrowDown' });
        await nextTick();
        expect(input.attributes('aria-expanded')).toBe('true');
        await input.trigger('keydown', { key: 'Escape' });
        expect(input.attributes('aria-expanded')).toBe('false');
        expect(editingSubscription.customUserAgent).toBe('clash-verge/v2.4.3');
        await input.trigger('keydown', { key: 'ArrowDown' });
        await input.trigger('keydown', { key: 'ArrowDown' });
        await input.trigger('keydown', { key: 'ArrowDown' });
        expect(editingSubscription.customUserAgent).toBe('clash-verge/v2.4.3');
        await input.trigger('keydown', { key: 'Enter' });
        expect(editingSubscription.customUserAgent).toBe('clash-verge/v2.5.10');
        expect(input.attributes('aria-expanded')).toBe('false');
    });

    it('closes on Tab or an outside pointer without replacing the current UA', async () => {
        const { wrapper, editingSubscription, input } = mountEditor({
            customUserAgent: 'CustomClient/1.0',
        });
        await openPresets(wrapper);
        await input.trigger('keydown', { key: 'Tab' });
        expect(input.attributes('aria-expanded')).toBe('false');
        await openPresets(wrapper);
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await nextTick();
        expect(input.attributes('aria-expanded')).toBe('false');
        expect(editingSubscription.customUserAgent).toBe('CustomClient/1.0');
    });

    it('uses the shared preset list and marks an old UA as custom', async () => {
        const { wrapper } = mountEditor({ customUserAgent: 'clash-verge/v2.4.3' });
        expect(wrapper.get('#sub-edit-ua-current').text()).toBe('自定义 UA: clash-verge/v2.4.3');
        await openPresets(wrapper);
        expect(document.querySelectorAll('[role="option"]').length).toBe(
            USER_AGENT_PRESETS.length + 1
        );
        for (const preset of USER_AGENT_PRESETS)
            expect(document.querySelector('[role="listbox"]').textContent).toContain(preset.value);
    });

    it('shows invalid saved input and clears the error after correction', async () => {
        const { wrapper, editingSubscription, input } = mountEditor({
            customUserAgent: 'Client/1.0\nExtra: bad',
        });
        expect(wrapper.get('[role="alert"]').text()).toContain('不能包含换行符');
        expect(input.attributes('aria-invalid')).toBe('true');
        expect(editingSubscription.customUserAgent).toBe('Client/1.0\nExtra: bad');
        await input.setValue('Client/1.0');
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(input.attributes('aria-invalid')).toBe('false');
    });

    it.each(['Client/1.0\nExtra: bad', '\r\n', 'Client\u0000', '中文 UA'])(
        'rejects invalid paste without changing the saved UA (%j)',
        async (text) => {
            const { wrapper, editingSubscription, input } = mountEditor({
                customUserAgent: 'Custom/1.0',
            });
            const event = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
            input.element.dispatchEvent(event);
            await nextTick();
            expect(event.defaultPrevented).toBe(true);
            expect(editingSubscription.customUserAgent).toBe('Custom/1.0');
            expect(wrapper.get('[role="alert"]').text()).toContain('未粘贴');
            await input.setValue('Custom/2.0');
            expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        }
    );
});
