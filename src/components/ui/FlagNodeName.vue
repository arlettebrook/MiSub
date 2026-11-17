<script setup>
    import { computed } from 'vue';
    import RegionFlag from './RegionFlag.vue';
    import { splitFlagName } from '../../../shared/node-emoji.js';
    const props = defineProps({ name: { type: String, default: '' } });
    const parts = computed(() => splitFlagName(props.name));
</script>
<template>
    <span :aria-label="name"
        ><template v-for="(part, index) in parts" :key="index"
            ><RegionFlag v-if="part.flag" :flag="part.flag" /><span v-else>{{
                part.text
            }}</span></template
        ></span
    >
</template>
