<script setup>
    import { computed } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    const props = defineProps({
        show: Boolean,
        busy: Boolean,
        reason: String,
        preserveEditing: Boolean,
    });
    const emit = defineEmits(['retry']);
    const { t } = useI18n();
    const title = computed(() =>
        t(
            props.reason === 'logout'
                ? 'session.logoutSync'
                : props.busy
                  ? 'session.verifying'
                  : 'session.waiting'
        )
    );
</script>

<template>
    <section
        v-if="show"
        class="mb-4 flex w-full flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"
        data-testid="session-verification"
    >
        <div role="status" aria-live="polite">
            <p class="font-medium">{{ title }}</p>
            <p class="mt-1">
                {{ t('session.operationsPaused') }}
            </p>
            <p v-if="preserveEditing && reason !== 'logout'" class="mt-1 opacity-80">
                {{ t('session.editsPreserved') }}
            </p>
        </div>
        <button
            type="button"
            :disabled="busy"
            @click="emit('retry')"
            class="shrink-0 self-start rounded-lg border border-amber-300 px-3 py-2 font-medium hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900/50 sm:self-auto"
        >
            {{ busy ? t('session.verifying') : t('session.retry') }}
        </button>
    </section>
</template>
