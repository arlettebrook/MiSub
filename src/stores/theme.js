import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';

export const useThemeStore = defineStore('theme', () => {
    const theme = ref('light');
    const themeMode = ref('system');
    let systemMediaQuery = null;

    function handleSystemThemeChange(event) {
        if (themeMode.value !== 'system') return;
        theme.value = event.matches ? 'dark' : 'light';
        updateThemeClass();
    }

    function getSystemMediaQuery() {
        if (
            !systemMediaQuery &&
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function'
        ) {
            systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            if (typeof systemMediaQuery.addEventListener === 'function') {
                systemMediaQuery.addEventListener('change', handleSystemThemeChange);
            } else if (typeof systemMediaQuery.addListener === 'function') {
                systemMediaQuery.addListener(handleSystemThemeChange);
            }
        }
        return systemMediaQuery;
    }

    function applyThemeMode() {
        const media = getSystemMediaQuery();
        theme.value =
            themeMode.value === 'system' ? (media?.matches ? 'dark' : 'light') : themeMode.value;
        updateThemeClass();
    }

    function initTheme() {
        let savedTheme = null;
        try {
            savedTheme = localStorage.getItem('theme');
        } catch (_) {}
        themeMode.value = ['light', 'dark'].includes(savedTheme) ? savedTheme : 'system';
        applyThemeMode();
    }

    function setThemeMode(mode) {
        themeMode.value = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';
        try {
            localStorage.setItem('theme', themeMode.value);
        } catch (_) {}
        applyThemeMode();
    }

    function toggleTheme() {
        setThemeMode(theme.value === 'dark' ? 'light' : 'dark');
    }

    function updateThemeClass() {
        if (theme.value === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        // 动态更新状态栏主题颜色
        updateStatusBarTheme();
    }

    function updateStatusBarTheme() {
        // 更新主题颜色的 meta 标签
        const color = theme.value === 'dark' ? '#08090a' : '#f7f8f8';
        document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
            meta.setAttribute('content', color);
        });

        // 更新 iOS 状态栏样式 - 统一使用黑色半透明配合Header渐变背景
        const statusBarMeta = document.querySelector(
            'meta[name="apple-mobile-web-app-status-bar-style"]'
        );
        if (statusBarMeta) {
            // 使用black-translucent让状态栏完全透明，由Header的渐变背景提供视觉效果
            statusBarMeta.setAttribute('content', 'black-translucent');
        }
    }

    onScopeDispose(() => {
        if (typeof systemMediaQuery?.removeEventListener === 'function') {
            systemMediaQuery.removeEventListener('change', handleSystemThemeChange);
        } else if (typeof systemMediaQuery?.removeListener === 'function') {
            systemMediaQuery.removeListener(handleSystemThemeChange);
        }
        systemMediaQuery = null;
    });

    return { theme, themeMode, initTheme, setThemeMode, toggleTheme };
});
