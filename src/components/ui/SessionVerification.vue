<script setup>
    import { ref, computed } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import { useModalFocus } from '../../composables/useModalFocus.js';
    const props = defineProps({
        show: Boolean,
        busy: Boolean,
        reason: String,
        preserveEditing: Boolean,
    });
    const emit = defineEmits(['retry']);
    const { t } = useI18n();
    const panel = ref(null);
    useModalFocus(panel, () => props.show, { priority: () => 2 });
    const title = computed(() =>
        t(
            props.reason === 'logout'
                ? 'session.logoutSync'
                : props.busy
                  ? 'session.verifying'
                  : 'session.waiting'
        )
    );
    const blockPageShortcuts = (event) => {
        if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation();
    };
</script>

<template>
    <Teleport to="body">
        <div
            v-if="show"
            class="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
            style="z-index: calc(var(--z-confirm, 100000) + 10)"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-verification-title"
            data-testid="session-verification"
            @keydown="blockPageShortcuts"
        >
            <section
                ref="panel"
                tabindex="-1"
                class="max-w-md w-full rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-xl focus:outline-none"
            >
                <h2
                    id="session-verification-title"
                    class="text-xl font-semibold text-gray-900 dark:text-white"
                >
                    {{ title }}
                </h2>
                <p class="mt-3 text-gray-600 dark:text-gray-300">
                    {{ t('session.operationsPaused') }}
                </p>
                <p
                    v-if="preserveEditing && reason !== 'logout'"
                    class="mt-2 text-sm text-gray-500 dark:text-gray-400"
                >
                    {{ t('session.editsPreserved') }}
                </p>
                <button
                    type="button"
                    :disabled="busy"
                    @click="emit('retry')"
                    class="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white disabled:opacity-50"
                >
                    {{ busy ? t('session.verifying') : t('session.retry') }}
                </button>
            </section>
        </div>
    </Teleport>
</template>
