import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { useThemeStore } from '../../src/stores/theme.js';
import ThemeToggle from '../../src/components/features/ThemeToggle.vue';
import { createI18n } from '../../src/i18n/index.js';

describe('manual theme preference', () => {
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

    function expectTheme(dark) {
        expect(store.theme).toBe(dark ? 'dark' : 'light');
        expect(document.documentElement.classList.contains('dark')).toBe(dark);
        for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
            expect(meta.content).toBe(dark ? '#08090a' : '#f7f8f8');
        }
    }

    it('uses a fixed light default without consulting the system appearance', () => {
        media.matches = true;
        store.initTheme();
        expectTheme(false);
        media.matches = false;
        expectTheme(false);
        expect(window.matchMedia).not.toHaveBeenCalled();
    });

    it('migrates the retired system preference to the fixed light default', () => {
        localStorage.setItem('theme', 'system');
        media.matches = true;
        store.initTheme();
        expectTheme(false);
        expect(localStorage.getItem('theme')).toBe('light');
    });

    it.each(['light', 'dark'])(
        'restores a saved %s preference independently of the system appearance',
        (saved) => {
            localStorage.setItem('theme', saved);
            media.matches = saved !== 'dark';
            store.initTheme();
            expectTheme(saved === 'dark');
            media.matches = !media.matches;
            expectTheme(saved === 'dark');
            expect(window.matchMedia).not.toHaveBeenCalled();
        }
    );

    it('toggles between light and dark and saves the manual selection', () => {
        media.matches = true;
        store.initTheme();
        store.toggleTheme();
        expect(localStorage.getItem('theme')).toBe('dark');
        expectTheme(true);
        store.toggleTheme();
        expect(localStorage.getItem('theme')).toBe('light');
        expectTheme(false);
    });

    it('does not register system appearance listeners', () => {
        store.initTheme();
        store.initTheme();
        expect(window.matchMedia).not.toHaveBeenCalled();
        expect(media.addEventListener).not.toHaveBeenCalled();
        store.$dispose();
        expect(media.removeEventListener).not.toHaveBeenCalled();
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
        expectTheme(false);
        expect(() => store.toggleTheme()).not.toThrow();
        expectTheme(true);
    });

    it('offers only light and dark through the theme button', async () => {
        store.initTheme();
        const wrapper = mount(ThemeToggle, {
            global: { plugins: [pinia, createI18n({ initialLocale: 'zh-CN' })] },
        });
        try {
            const button = wrapper.get('button');
            expect(button.attributes('aria-label')).toBe('切换到暗色模式');
            expect(button.attributes('aria-pressed')).toBe('false');
            await button.trigger('click');
            expectTheme(true);
            expect(button.attributes('aria-label')).toBe('切换到亮色模式');
            expect(button.attributes('aria-pressed')).toBe('true');
            await button.trigger('click');
            expectTheme(false);
            expect(localStorage.getItem('theme')).toBe('light');
        } finally {
            wrapper.unmount();
        }
    });
});
