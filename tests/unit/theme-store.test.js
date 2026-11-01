import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { useThemeStore } from '../../src/stores/theme.js';
import ThemeToggle from '../../src/components/features/ThemeToggle.vue';
import { createI18n } from '../../src/i18n/index.js';

describe('system theme preference', () => {
    let media;
    let store;
    let pinia;

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.classList.remove('dark');
        document.head.innerHTML =
            '<meta name="theme-color"><meta name="theme-color" media="(prefers-color-scheme: dark)">';
        media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        vi.spyOn(window, 'matchMedia').mockReturnValue(media);
        pinia = createPinia();
        setActivePinia(pinia);
        store = useThemeStore();
    });

    afterEach(() => {
        store.$dispose();
        vi.restoreAllMocks();
        localStorage.clear();
        document.documentElement.classList.remove('dark');
        document.head.innerHTML = '';
    });

    function changeSystemTheme(dark) {
        media.matches = dark;
        const listener = media.addEventListener.mock.calls.find(([event]) => event === 'change')[1];
        listener({ matches: dark });
    }

    function expectTheme(dark) {
        expect(store.theme).toBe(dark ? 'dark' : 'light');
        expect(document.documentElement.classList.contains('dark')).toBe(dark);
        for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
            expect(meta.content).toBe(dark ? '#08090a' : '#f7f8f8');
        }
    }

    it('defaults to the system and updates the page and system bars without a reload', () => {
        store.initTheme();
        expect(store.themeMode).toBe('system');
        expectTheme(false);
        changeSystemTheme(true);
        expectTheme(true);
        changeSystemTheme(false);
        expectTheme(false);
    });

    it('restores explicit system mode using the current system appearance', () => {
        localStorage.setItem('theme', 'system');
        media.matches = true;
        store.initTheme();
        expect(store.themeMode).toBe('system');
        expectTheme(true);
    });

    it.each(['light', 'dark'])(
        'keeps a saved %s preference until system mode is selected',
        (saved) => {
            localStorage.setItem('theme', saved);
            media.matches = saved !== 'dark';
            store.initTheme();
            expect(store.themeMode).toBe(saved);
            expectTheme(saved === 'dark');
            changeSystemTheme(!media.matches);
            expectTheme(saved === 'dark');
            store.setThemeMode('system');
            expect(localStorage.getItem('theme')).toBe('system');
            expectTheme(media.matches);
            changeSystemTheme(!media.matches);
            expectTheme(media.matches);
        }
    );

    it('preserves the existing manual toggle API for custom pages', () => {
        media.matches = true;
        store.initTheme();
        store.toggleTheme();
        expect(store.themeMode).toBe('light');
        expect(localStorage.getItem('theme')).toBe('light');
        expectTheme(false);
    });

    it('registers one system listener and removes it when the store is disposed', () => {
        store.initTheme();
        store.initTheme();
        expect(media.addEventListener).toHaveBeenCalledOnce();
        const listener = media.addEventListener.mock.calls[0][1];
        store.$dispose();
        expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
    });

    it('still applies themes when local storage is unavailable', () => {
        vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        media.matches = true;
        expect(() => store.initTheme()).not.toThrow();
        expectTheme(true);
        expect(() => store.setThemeMode('light')).not.toThrow();
        expectTheme(false);
    });

    it('lets the theme button cycle through system, light and dark modes', async () => {
        store.initTheme();
        const wrapper = mount(ThemeToggle, {
            global: { plugins: [pinia, createI18n({ initialLocale: 'zh-CN' })] },
        });
        try {
            const button = wrapper.get('button');
            expect(button.attributes('aria-label')).toContain('跟随系统');
            await button.trigger('click');
            expect(store.themeMode).toBe('light');
            await button.trigger('click');
            expect(store.themeMode).toBe('dark');
            await button.trigger('click');
            expect(store.themeMode).toBe('system');
            expect(localStorage.getItem('theme')).toBe('system');
        } finally {
            wrapper.unmount();
        }
    });
});
