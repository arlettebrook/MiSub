<script setup>
    import Modal from '../forms/Modal.vue';
    import { useI18n } from '../../i18n/index.js';

    const { t } = useI18n();
    defineProps({ profile: { type: Object, required: true }, isExpanded: Boolean });
    const emit = defineEmits(['close', 'download', 'register-canvas']);
</script>

<template>
    <Modal :show="isExpanded" size="sm" @update:show="(show) => !show && emit('close')">
        <template #title>
            <div class="flex items-center justify-between gap-4">
                <h4 class="text-xl font-bold text-gray-900 dark:text-white">{{ profile.name }}</h4>
                <button
                    type="button"
                    @click="emit('close')"
                    class="touch-target rounded-xl text-gray-500 dark:text-gray-400"
                    :aria-label="t('common.close')"
                >
                    <svg
                        aria-hidden="true"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        />
                    </svg>
                </button>
            </div>
        </template>
        <template #body>
            <div class="flex flex-col items-center pt-2">
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {{ t('public.scanToImport') }}
                </p>

                <div
                    class="bg-white p-3 misub-radius-lg shadow-inner border border-gray-100 w-64 max-w-full aspect-square flex items-center justify-center"
                >
                    <canvas
                        :ref="
                            (el) => {
                                if (el) emit('register-canvas', profile.id, el);
                            }
                        "
                        class="qr-canvas max-w-full misub-radius-md"
                    ></canvas>
                </div>
            </div>
        </template>
        <template #footer>
            <button
                @click="emit('download')"
                class="w-full flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 misub-radius-lg transition-all shadow-lg shadow-primary-600/20 active:scale-95"
            >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                </svg>
                {{ t('public.downloadQr') }}
            </button>
        </template>
    </Modal>
</template>

<style scoped>
    .qr-canvas {
        height: auto !important;
    }
</style>
