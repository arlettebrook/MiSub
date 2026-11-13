<script setup>
    import Modal from '../forms/Modal.vue';
    import { useI18n } from '../../i18n/index.js';

    defineProps({ show: Boolean, title: String, size: String, error: Boolean });
    const emit = defineEmits(['close', 'retry']);
    const { t } = useI18n();
</script>

<template>
    <Modal :show="show" :size="size" @update:show="emit('close')">
        <template #title>
            <div class="flex items-center justify-between gap-4">
                <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ title }}</h3>
                <button
                    type="button"
                    class="touch-target px-3 py-2"
                    :aria-label="t('common.close')"
                    @click="emit('close')"
                >
                    <span aria-hidden="true">×</span>
                </button>
            </div>
        </template>
        <template #body>
            <div
                class="min-h-48 space-y-4"
                :role="error ? 'alert' : 'status'"
                :aria-busy="!error"
                aria-live="polite"
                data-testid="modal-code-loading"
            >
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{
                        error
                            ? t('loadingFeedback.componentFailed')
                            : t('loadingFeedback.componentLoading')
                    }}
                </p>
                <div v-if="!error" class="space-y-4 animate-pulse" aria-hidden="true">
                    <div class="h-5 w-1/2 rounded bg-gray-200 dark:bg-gray-700"></div>
                    <div class="h-24 rounded bg-gray-100 dark:bg-gray-800"></div>
                </div>
                <button
                    v-else
                    type="button"
                    class="touch-target rounded bg-indigo-600 px-4 py-2 text-white"
                    @click="emit('retry')"
                >
                    {{ t('common.retry') }}
                </button>
            </div>
        </template>
        <template #footer>
            <button
                type="button"
                class="touch-target rounded bg-gray-100 px-4 py-2 dark:bg-gray-800"
                @click="emit('close')"
            >
                {{ t('common.close') }}
            </button>
        </template>
    </Modal>
</template>
