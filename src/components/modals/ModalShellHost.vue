<script setup>
    import { computed, defineComponent, h, nextTick, inject, ref, watch } from 'vue';
    import Modal from '../forms/Modal.vue';
    import ModalLoading from './ModalLoading.vue';
    import { modalShellKey } from '../../composables/useModalShell.js';
    import { useI18n } from '../../i18n/index.js';

    const props = defineProps({
        show: Boolean,
        title: String,
        size: String,
        error: Boolean,
        bodyMinHeight: String,
    });
    const emit = defineEmits(['close', 'retry']);
    const { t } = useI18n();
    const { content, revision } = inject(modalShellKey);
    const shell = ref(null);
    const shellProps = computed(() => {
        revision.value;
        if (!content.value) return {};
        const { show, size, shellHost, bodyMinHeight, ...controls } = content.value.props;
        return { ...controls, ...content.value.attrs };
    });
    const forwardedSlots = computed(() => {
        revision.value;
        return { ...content.value?.slots };
    });
    const SlotContent = defineComponent({
        props: { name: String },
        setup(slotProps) {
            return () => forwardedSlots.value[slotProps.name]?.();
        },
    });
    const handleClose = () => {
        if (content.value) content.value.emit('update:show', false);
        else emit('close');
    };
    // The layer stays registered while its content changes. Only repair focus if the
    // loading control that held it was removed; never move focus from a user's input.
    watch(content, async (loaded) => {
        if (loaded && props.show) {
            await nextTick();
            shell.value?.ensureFocus();
        }
    });
</script>

<template>
    <Modal
        ref="shell"
        v-bind="shellProps"
        :shell-host="true"
        :show="show"
        :size="size"
        :body-min-height="bodyMinHeight"
        @update:show="handleClose"
        @confirm="content?.emit('confirm')"
    >
        <template v-if="!content || forwardedSlots.title" #title>
            <SlotContent v-if="content" name="title" />
            <div v-else class="flex items-center justify-between gap-4">
                <h3 class="text-lg font-bold text-gray-900 dark:text-white">{{ title }}</h3>
                <button
                    type="button"
                    class="touch-target flex shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    :aria-label="t('common.close')"
                    @click="handleClose"
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
        <template v-if="!content || forwardedSlots.body" #body>
            <SlotContent v-if="content" name="body" />
            <ModalLoading
                v-else
                :show="show"
                :error="error"
                :min-height="bodyMinHeight"
                @retry="emit('retry')"
            />
        </template>
        <template v-if="!content || forwardedSlots.footer" #footer>
            <SlotContent v-if="content" name="footer" />
            <button
                v-else
                type="button"
                class="touch-target rounded bg-gray-100 px-4 py-2 dark:bg-gray-800"
                @click="handleClose"
            >
                {{ t('common.close') }}
            </button>
        </template>
    </Modal>
</template>
