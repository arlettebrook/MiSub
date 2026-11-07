import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import GroupSelector from '../../src/components/ui/GroupSelector.vue';

describe('GroupSelector', () => {
    it('keeps teleported groups aligned with the field without adding page scroll offsets', async () => {
        const wrapper = mount(GroupSelector, {
            props: { modelValue: '', groups: ['Group A'] },
            attachTo: document.body,
        });
        const rect = vi
            .spyOn(wrapper.get('input').element, 'getBoundingClientRect')
            .mockReturnValue({
                left: 24,
                bottom: 120,
                width: 240,
            });
        const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(600);
        try {
            await wrapper.get('[data-testid="group-selector-toggle"]').trigger('click');
            await nextTick();
            await nextTick();
            const popup = document.querySelector('[data-testid="group-selector-dropdown"]');
            expect(popup.style.top).toBe('124px');
            expect(popup.style.left).toBe('24px');
            expect(popup.classList.contains('fixed')).toBe(true);
            expect(wrapper.get('input').attributes('aria-controls')).toBe(popup.id);
        } finally {
            wrapper.unmount();
            rect.mockRestore();
            scrollY.mockRestore();
        }
    });

    it('点击下拉箭头时展示全部已有分组，而不是只展示当前分组', async () => {
        const wrapper = mount(GroupSelector, {
            props: {
                modelValue: 'FreezeHost',
                groups: ['FreezeHost', 'S5'],
                placeholder: '选择或输入新分组...',
            },
            attachTo: document.body,
            global: { stubs: { Teleport: false } },
        });

        await wrapper.find('[data-testid="group-selector-toggle"]').trigger('click');
        await nextTick();
        await nextTick();

        expect(document.body.textContent).toContain('FreezeHost');
        expect(document.body.textContent).toContain('S5');

        wrapper.unmount();
    });

    it('已有分组只存在首尾空白差异时不显示创建新分组', async () => {
        const wrapper = mount(GroupSelector, {
            props: {
                modelValue: ' S5 ',
                groups: ['S5'],
                placeholder: '选择或输入新分组...',
            },
            attachTo: document.body,
            global: { stubs: { Teleport: false } },
        });

        await wrapper.find('[data-testid="group-selector-toggle"]').trigger('click');
        await nextTick();
        await nextTick();

        expect(document.body.textContent).toContain('S5');
        expect(document.body.textContent).not.toContain('创建新分组');

        wrapper.unmount();
    });
});
