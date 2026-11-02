<script setup>
    import { useI18n } from '../../i18n/index.js';

    const { t } = useI18n();
    defineProps({
        isSaving: Boolean,
        disabled: Boolean,
    });
    defineEmits(['save']);
</script>

<template>
    <button
        type="button"
        @click="$emit('save')"
        :disabled="disabled || isSaving"
        :aria-busy="isSaving"
        class="min-h-11 min-w-28 shrink-0 justify-center px-6 py-2.5 misub-radius-lg text-white text-sm font-medium shadow-sm transition-all flex items-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
        :class="
            isSaving
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700 hover:shadow-md active:scale-95'
        "
    >
        <svg
            v-if="isSaving"
            class="animate-spin h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
            ></circle>
            <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>
        <span>{{ isSaving ? t('settings.saving') : t('settings.saveChanges') }}</span>
    </button>
</template>
