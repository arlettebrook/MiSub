<script setup>
    import { computed } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useThemeStore } from '../../stores/theme.js';
    import { useI18n } from '@/i18n/index.js';

    const store = useThemeStore();
    const { themeMode } = storeToRefs(store);
    const { setThemeMode } = store;
    const { t } = useI18n();
    const nextThemeMode = computed(
        () => ({ system: 'light', light: 'dark', dark: 'system' })[themeMode.value]
    );
    const labelKeys = {
        system: 'common.themeSystem',
        light: 'common.themeLight',
        dark: 'common.themeDark',
    };
    const switchLabel = computed(() =>
        t('common.themeModeSwitch', {
            current: t(labelKeys[themeMode.value]),
            next: t(labelKeys[nextThemeMode.value]),
        })
    );
</script>

<template>
    <button
        @click="setThemeMode(nextThemeMode)"
        class="nav-action-btn nav-action-btn-neutral rounded-full"
        :title="switchLabel"
        :aria-label="switchLabel"
    >
        <div
            v-if="themeMode === 'system'"
            key="system-icon"
            class="transition-opacity duration-300"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 17v4m6-4v4m-8 0h10M5 3h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"
                />
            </svg>
        </div>
        <div
            v-else-if="themeMode === 'light'"
            key="light-icon"
            class="transition-opacity duration-300"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
            </svg>
        </div>
        <div v-else key="dark-icon" class="transition-opacity duration-300">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
            </svg>
        </div>
    </button>
</template>
