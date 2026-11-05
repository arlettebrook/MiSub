<script setup>
    import { computed, onScopeDispose, ref, useId, watch } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import { useModalFocus } from '../../composables/useModalFocus.js';
    const props = defineProps({
        show: Boolean,
        busy: Boolean,
        reason: String,
    });
    const emit = defineEmits(['retry']);
    const { t } = useI18n();
    const panelRef = ref(null);
    const titleId = useId();
    const descriptionId = useId();
    useModalFocus(panelRef, () => props.show, { priority: () => 2 });

    let previousOverflow;
    const restoreScroll = () => {
        if (previousOverflow === undefined) return;
        document.body.style.overflow = previousOverflow;
        previousOverflow = undefined;
    };
    watch(
        () => props.show,
        (visible) => {
            if (!visible) return restoreScroll();
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        },
        { immediate: true }
    );
    onScopeDispose(restoreScroll);

    const retry = () => {
        if (!props.busy) emit('retry');
    };
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
    <Teleport to="body">
        <div
            v-if="show"
            class="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-xs"
            style="z-index: var(--z-session)"
            data-testid="session-verification"
        >
            <section
                ref="panelRef"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                :aria-describedby="descriptionId"
                :aria-busy="busy"
                tabindex="-1"
                class="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-2xl focus-visible:outline-none dark:border-amber-800 dark:bg-gray-900"
            >
                <div
                    class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
                    aria-hidden="true"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="h-6 w-6"
                    >
                        <path
                            d="m10.3 3.9-8.2 14.2A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
                        />
                        <path d="M12 9v4m0 4h.01" />
                    </svg>
                </div>
                <div role="status" aria-live="polite">
                    <h2 :id="titleId" class="text-lg font-semibold text-gray-900 dark:text-white">
                        {{ title }}
                    </h2>
                    <p
                        :id="descriptionId"
                        class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300"
                    >
                        {{ t('session.operationsPaused') }}
                    </p>
                </div>
                <button
                    type="button"
                    :disabled="busy"
                    @click="retry"
                    class="mt-6 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-500 dark:text-gray-950 dark:hover:bg-amber-400"
                >
                    {{ busy ? t('session.verifying') : t('session.retry') }}
                </button>
            </section>
        </div>
    </Teleport>
</template>
