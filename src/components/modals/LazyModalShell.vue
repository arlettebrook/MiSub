<script setup>
    import { provide, ref, shallowRef } from 'vue';
    import ModalShellHost from './ModalShellHost.vue';
    import { modalShellKey } from '../../composables/useModalShell.js';

    defineOptions({ inheritAttrs: false });
    provide(modalShellKey, { content: shallowRef(null), revision: ref(0) });
</script>

<template>
    <ModalShellHost v-bind="$attrs" />
    <!-- Keep this subtree independent of slot/prop updates in the visible shell. -->
    <slot />
</template>
