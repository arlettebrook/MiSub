<script setup>
    import { provide, ref, shallowRef } from 'vue';
    import ModalShellHost from './ModalShellHost.vue';
    import { modalShellKey } from '../../composables/useModalShell.js';
    import {
        modalLoadingFeedbackKey,
        useModalLoadingFeedback,
    } from '../../composables/useModalLoadingFeedback.js';

    defineOptions({ inheritAttrs: false });
    const props = defineProps({ show: Boolean });
    provide(modalShellKey, { content: shallowRef(null), revision: ref(0) });
    provide(
        modalLoadingFeedbackKey,
        useModalLoadingFeedback(() => props.show, false)
    );
</script>

<template>
    <ModalShellHost v-bind="$attrs" :show="show" />
    <!-- Keep this subtree independent of slot/prop updates in the visible shell. -->
    <slot />
</template>
