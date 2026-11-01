import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useThemeStore = defineStore('theme', () => {
    const theme = ref('light');

    function initTheme() {
        let savedTheme = null;
        try {
            savedTheme = localStorage.getItem('theme');
        } catch (_) {}
        theme.value = savedTheme === 'dark' ? 'dark' : 'light';
        if (savedTheme === 'system') {
            try {
                localStorage.setItem('theme', theme.value);
            } catch (_) {}
        }
        updateThemeClass();
    }

    function toggleTheme() {
        theme.value = theme.value === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem('theme', theme.value);
        } catch (_) {}
        updateThemeClass();
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

    return { theme, initTheme, toggleTheme };
});
