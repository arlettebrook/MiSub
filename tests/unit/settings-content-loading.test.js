import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h } from 'vue';
import { createI18n } from '../../src/i18n/index.js';
const gates = vi.hoisted(() => ({ resolve: {}, loads: {} }));
vi.mock('../../src/utils/settings-section-loaders.js', () => ({
    settingsSectionLoaders: Object.fromEntries(
        ['basic', 'home', 'service', 'global', 'system', 'webdav', 'client', 'custom-page'].map(
            (tab) => [
                tab,
                (gates.loads[tab] = vi.fn(
                    () => new Promise((resolve) => (gates.resolve[tab] = resolve))
                )),
            ]
        )
    ),
}));
import SettingsContent from '../../src/components/settings/SettingsContent.vue';
const section = (name) => ({ render: () => h('div', { 'data-section': name }, name) });
describe('settings code loading', () => {
    it('loads only visited sections, reports system ready after both modules, and retains mounted content', async () => {
        const wrapper = mount(SettingsContent, {
            props: { activeTab: 'basic', settings: {}, disguiseConfig: {} },
            global: { plugins: [createI18n({ initialLocale: 'en-US' })] },
        });
        try {
            await flushPromises();
            expect(gates.loads.basic).toHaveBeenCalledTimes(1);
            expect(gates.loads.system).not.toHaveBeenCalled();
            expect(wrapper.get('[role="status"]').exists()).toBe(true);
            expect(wrapper.emitted('section-mounted')).toBeUndefined();
            gates.resolve.basic({ default: section('basic') });
            await flushPromises();
            const basic = wrapper.get('[data-section="basic"]').element;
            expect(wrapper.emitted('section-mounted')).toEqual([['basic']]);
            await wrapper.setProps({ activeTab: 'system' });
            await flushPromises();
            expect(gates.loads.system).toHaveBeenCalledTimes(1);
            expect(gates.loads.webdav).toHaveBeenCalledTimes(1);
            gates.resolve.system({ default: section('system') });
            await flushPromises();
            expect(wrapper.emitted('section-mounted')).toEqual([['basic']]);
            gates.resolve.webdav({ default: section('webdav') });
            await flushPromises();
            expect(wrapper.emitted('section-mounted')).toEqual([['basic'], ['system']]);
            await wrapper.setProps({ activeTab: 'basic' });
            await flushPromises();
            expect(wrapper.get('[data-section="basic"]').element).toBe(basic);
            expect(gates.loads.basic).toHaveBeenCalledTimes(1);
            expect(gates.loads.client).not.toHaveBeenCalled();
            expect(gates.loads['custom-page']).not.toHaveBeenCalled();
        } finally {
            wrapper.unmount();
        }
    });
});
