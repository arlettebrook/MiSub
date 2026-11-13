<script setup>
    import { useI18n } from '../../i18n/index.js';

    const { t } = useI18n();
</script>

<template>
    <div class="min-h-60 space-y-4" role="status" aria-live="polite">
        <span class="sr-only">{{ t('settings.loading') }}</span>
        <div class="h-6 w-36 rounded bg-gray-200 dark:bg-gray-700 animate-pulse"></div>
        <div class="h-20 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"></div>
        <div class="h-20 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"></div>
    </div>
</template>
