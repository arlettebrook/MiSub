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
                    class="touch-target flex shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    :aria-label="t('common.close')"
                    @click="emit('close')"
                >
                    <svg
                        aria-hidden="true"
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                    >
                        <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                </button>
            </div>
        </template>
        <template #body>
            <div
                class="flex min-h-44 flex-col items-center justify-center gap-5 py-5 text-center"
                :role="error ? 'alert' : 'status'"
                :aria-busy="!error"
                aria-live="polite"
                data-testid="modal-code-loading"
            >
                <div
                    v-if="!error"
                    class="loading-orbit text-indigo-500 dark:text-indigo-400"
                    aria-hidden="true"
                >
                    <div class="loading-halo"></div>
                    <div class="loading-ring"></div>
                    <div class="loading-dots"><span></span><span></span><span></span></div>
                </div>
                <div
                    v-else
                    class="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-400"
                    aria-hidden="true"
                >
                    <svg
                        class="h-6 w-6"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                    >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v6m0 4h.01" />
                    </svg>
                </div>
                <p class="max-w-xs text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                    {{
                        error
                            ? t('loadingFeedback.componentFailed')
                            : t('loadingFeedback.componentLoading')
                    }}
                </p>
                <button
                    v-if="error"
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

<style scoped>
    .loading-orbit {
        position: relative;
        display: grid;
        width: 64px;
        height: 64px;
        place-items: center;
    }

    .loading-halo {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: radial-gradient(circle, currentColor, transparent 70%);
        opacity: 0.08;
        animation: loading-breathe 2.4s ease-in-out infinite;
    }

    .loading-ring {
        position: absolute;
        inset: 0;
        border: 2px solid color-mix(in srgb, currentColor 14%, transparent);
        border-top-color: currentColor;
        border-right-color: color-mix(in srgb, currentColor 45%, transparent);
        border-radius: 50%;
        animation: loading-orbit 1.2s linear infinite;
    }

    .loading-dots {
        display: flex;
        gap: 4px;
    }

    .loading-dots span {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        animation: loading-dot 1.2s ease-in-out infinite;
    }

    .loading-dots span:nth-child(2) {
        animation-delay: 0.15s;
    }

    .loading-dots span:nth-child(3) {
        animation-delay: 0.3s;
    }

    @keyframes loading-orbit {
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes loading-breathe {
        50% {
            opacity: 0.16;
            transform: scale(1.1);
        }
    }

    @keyframes loading-dot {
        0%,
        80%,
        100% {
            opacity: 0.35;
        }
        40% {
            opacity: 1;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .loading-halo,
        .loading-ring,
        .loading-dots span {
            animation: none;
        }
    }
</style>
