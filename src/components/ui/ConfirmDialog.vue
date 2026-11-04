<script setup>
    import { onMounted, onUnmounted } from 'vue';
    import Modal from '../forms/Modal.vue';
    import { useI18n } from '../../i18n/index.js';
    import { registerConfirmHost, useConfirmState } from '../../composables/useConfirm.js';

    const { t } = useI18n();
    const pending = useConfirmState();
    let unregisterHost;
    onMounted(() => {
        unregisterHost = registerConfirmHost();
    });
    onUnmounted(() => unregisterHost?.());
</script>

<template>
    <Modal
        v-if="pending"
        :key="pending.id"
        :show="true"
        size="sm"
        layer="confirmation"
        :close-on-confirm="false"
        :confirm-text="pending.confirmText"
        :cancel-text="pending.cancelText"
        :confirm-variant="pending.variant"
        :description-id="`confirm-message-${pending.id}`"
        v-on="pending.listeners"
    >
        <template #title>
            <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                {{ pending.title || t('common.confirmAction') }}
            </h3>
        </template>
        <template #body>
            <p
                :id="`confirm-message-${pending.id}`"
                style="overflow-wrap: anywhere"
                class="text-sm leading-relaxed text-gray-600 whitespace-pre-line dark:text-gray-300"
            >
                {{ pending.message || t('common.confirmContinue') }}
            </p>
        </template>
    </Modal>
</template>
