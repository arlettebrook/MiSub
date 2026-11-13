import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useIdlePreload } from '../../src/composables/useIdlePreload.js';
import { cachedLoader } from '../../src/utils/load-timing.js';
import {
    preferredSettingsTab,
    preloadPreferredSettingsSection,
    settingsSectionLoaders,
} from '../../src/utils/settings-section-loaders.js';

let wrapper;
afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
});

describe('idle component preloading', () => {
    it('waits for page readiness, cancels queued work, and imports without mounting', async () => {
        vi.useFakeTimers();
        const ready = ref(false);
        const setup = vi.fn();
        const load = vi.fn(async () => defineComponent({ setup, render: () => null }));
        wrapper = mount(
            defineComponent({
                setup() {
                    useIdlePreload(ready, { dialog: load });
                    return () => h('main');
                },
            })
        );
        await vi.advanceTimersByTimeAsync(1000);
        expect(load).not.toHaveBeenCalled();
        ready.value = true;
        await nextTick();
        await vi.advanceTimersByTimeAsync(499);
        expect(load).not.toHaveBeenCalled();
        ready.value = false;
        await nextTick();
        await vi.advanceTimersByTimeAsync(1000);
        expect(load).not.toHaveBeenCalled();
        ready.value = true;
        await nextTick();
        await vi.advanceTimersByTimeAsync(500);
        expect(load).toHaveBeenCalledOnce();
        expect(setup).not.toHaveBeenCalled();
        expect(wrapper.html()).toBe('<main></main>');
    });

    it('shares a pending import with foreground loading and allows retry after failure', async () => {
        let finish;
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error('Offline'))
            .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        const shared = cachedLoader('test:code', load);
        await expect(shared()).rejects.toThrow('Offline');
        const background = shared();
        expect(shared()).toBe(background);
        finish('ready');
        await expect(background).resolves.toBe('ready');
        expect(load).toHaveBeenCalledTimes(2);
        expect(shared()).toBe(background);
    });

    it('preloads the remembered settings section and both parts of System', async () => {
        const basic = vi.spyOn(settingsSectionLoaders, 'basic').mockResolvedValue({});
        const system = vi.spyOn(settingsSectionLoaders, 'system').mockResolvedValue({});
        const webdav = vi.spyOn(settingsSectionLoaders, 'webdav').mockResolvedValue({});
        sessionStorage.setItem('misub:settings-active-tab', 'system');
        await preloadPreferredSettingsSection();
        expect(system).toHaveBeenCalledOnce();
        expect(webdav).toHaveBeenCalledOnce();
        expect(basic).not.toHaveBeenCalled();
        sessionStorage.setItem('misub:settings-active-tab', 'invalid');
        expect(preferredSettingsTab()).toBe('basic');
        sessionStorage.setItem('misub:settings-active-tab', 'constructor');
        expect(preferredSettingsTab()).toBe('basic');
    });
});
