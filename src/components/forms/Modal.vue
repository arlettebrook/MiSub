<script setup>
    import { ref, computed, provide, useAttrs, useSlots } from 'vue';
    import { useI18n } from '@/i18n/index.js';
    import { useBackdropDismiss } from '@/composables/useBackdropDismiss.js';
    import { useModalFocus } from '@/composables/useModalFocus.js';
    import { useModalShell } from '@/composables/useModalShell.js';
    import { modalTriggerKey } from '@/composables/modal-trigger.js';

    const props = defineProps({
        show: Boolean,
        shellHost: Boolean,
        bodyMinHeight: String,
        confirmKeyword: String,
        size: {
            type: String,
            default: 'sm',
        },
        confirmDisabled: {
            type: Boolean,
            default: false,
        },
        confirmButtonTitle: {
            type: String,
            default: '',
        },
        closeOnConfirm: {
            type: Boolean,
            default: true,
        },
        confirmText: {
            type: String,
            default: '',
        },
        cancelText: {
            type: String,
            default: '',
        },
        confirmVariant: {
            type: String,
            default: 'primary',
            validator: (value) => ['primary', 'danger'].includes(value),
        },
        layer: {
            type: String,
            default: 'modal',
            validator: (value) => ['modal', 'confirmation'].includes(value),
        },
        descriptionId: {
            type: String,
            default: '',
        },
    });

    const emit = defineEmits(['update:show', 'confirm']);
    const delegated = useModalShell(props, useAttrs(), useSlots(), emit);
    const { t } = useI18n();
    const confirmLabel = computed(() => props.confirmText || t('actions.confirm'));
    const cancelLabel = computed(() => props.cancelText || t('actions.cancel'));
    const confirmTitle = computed(() => props.confirmButtonTitle || t('actions.confirm'));

    const confirmInput = ref('');
    const modalPanelRef = ref(null);
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 10)}`;

    const { isTopModal, ensureFocus } = useModalFocus(
        modalPanelRef,
        () => props.show && !delegated,
        {
            priority: () => (props.layer === 'confirmation' ? 1 : 0),
            onEscape: () => emit('update:show', false),
        }
    );
    defineExpose({ ensureFocus });
    provide(modalTriggerKey, null);

    const handleConfirm = () => {
        if (
            props.confirmDisabled ||
            (props.confirmKeyword && confirmInput.value !== props.confirmKeyword)
        )
            return;
        emit('confirm');
        if (props.closeOnConfirm) {
            emit('update:show', false);
        }
    };

    const { handleBackdropPointerDown, handleBackdropClick } = useBackdropDismiss(() =>
        emit('update:show', false)
    );
</script>

<template>
    <Teleport v-if="!delegated" to="body">
        <Transition name="modal-fade">
            <div
                v-if="show"
                data-modal-scroll-root
                class="fixed inset-0 w-screen bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
                :style="{
                    zIndex: layer === 'confirmation' ? 'var(--z-confirm)' : 'var(--z-modal)',
                }"
                @pointerdown.capture="handleBackdropPointerDown"
                @click="handleBackdropClick"
                role="dialog"
                :aria-modal="isTopModal ? 'true' : 'false'"
                :aria-hidden="isTopModal ? undefined : 'true'"
                :inert="!isTopModal"
                :aria-labelledby="titleId"
                :aria-describedby="descriptionId || undefined"
            >
                <Transition name="modal-inner">
                    <div
                        v-if="show"
                        ref="modalPanelRef"
                        tabindex="-1"
                        class="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl misub-radius-lg shadow-2xl w-full min-w-0 text-left ring-1 ring-black/5 dark:ring-white/10 flex flex-col max-h-[85vh] lg:max-h-[90vh] border border-white/20 dark:border-white/5 focus-visible:outline-none"
                        :class="{
                            'max-w-sm': size === 'sm',
                            'max-w-md': size === 'md',
                            'max-w-lg': size === 'lg',
                            'max-w-xl': size === 'xl',
                            'max-w-2xl': size === '2xl',
                            'max-w-4xl': size === '4xl',
                            'max-w-5xl': size === '5xl',
                            'max-w-6xl': size === '6xl',
                            'max-w-7xl': size === '7xl',
                        }"
                        @click.stop
                    >
                        <div :id="titleId" class="p-6 pb-4 shrink-0">
                            <slot name="title">
                                <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                                    {{ t('common.confirmAction') }}
                                </h3>
                            </slot>
                        </div>

                        <div
                            class="px-6 pb-6 grow overflow-y-auto"
                            :style="{ minHeight: bodyMinHeight }"
                        >
                            <slot name="body">
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    {{ t('common.confirmContinue') }}
                                </p>
                            </slot>
                        </div>

                        <div
                            class="p-6 pt-4 flex justify-end space-x-3 shrink-0 border-t border-gray-200 dark:border-gray-700"
                        >
                            <slot name="footer">
                                <button
                                    type="button"
                                    @click="emit('update:show', false)"
                                    class="touch-target px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold text-sm misub-radius-lg transition-colors"
                                >
                                    {{ cancelLabel }}
                                </button>
                                <button
                                    type="button"
                                    @click="handleConfirm"
                                    :disabled="
                                        confirmDisabled ||
                                        (confirmKeyword && confirmInput !== confirmKeyword)
                                    "
                                    :title="confirmDisabled ? confirmTitle : t('actions.confirm')"
                                    class="touch-target px-4 py-2 text-white font-semibold text-sm misub-radius-lg transition-colors disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed"
                                    :class="
                                        confirmVariant === 'danger'
                                            ? 'bg-red-600 hover:bg-red-700'
                                            : 'bg-indigo-600 hover:bg-indigo-700'
                                    "
                                >
                                    {{ confirmLabel }}
                                </button>
                            </slot>
                        </div>
                    </div>
                </Transition>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
    .modal-fade-enter-active,
    .modal-fade-leave-active {
        transition: opacity 0.2s ease;
    }

    .modal-fade-enter-from,
    .modal-fade-leave-to {
        opacity: 0;
    }

    .modal-inner-enter-active,
    .modal-inner-leave-active {
        transition: all 0.3s ease-out;
    }

    .modal-inner-enter-active,
    .modal-inner-leave-active {
        transition: all 0.25s ease;
    }

    .modal-inner-enter-from,
    .modal-inner-leave-to {
        opacity: 0;
        transform: translateY(50px);
    }

    @media (min-width: 768px) {
        .modal-inner-enter-from,
        .modal-inner-leave-to {
            opacity: 0;
            transform: scale(0.95);
        }
    }
</style>
