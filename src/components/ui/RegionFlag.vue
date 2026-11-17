<script setup>
    import { computed, ref, watch } from 'vue';
    import {
        getRegionCode,
        getRegionDisplayEmoji,
        identifyNodeRegion,
    } from '../../../shared/node-regions.js';
    const props = defineProps({
        region: { type: String, default: '其他' },
        flag: { type: String, default: '' },
        label: { type: Boolean, default: false },
    });
    const failed = ref(false);
    const code = computed(() => {
        const emoji = props.flag || getRegionDisplayEmoji(props.region);
        const letters = [...emoji];
        if (
            letters.length >= 2 &&
            letters
                .slice(0, 2)
                .every(
                    (letter) => letter.codePointAt(0) >= 0x1f1e6 && letter.codePointAt(0) <= 0x1f1ff
                )
        )
            return letters
                .slice(0, 2)
                .map((letter) => String.fromCharCode(letter.codePointAt(0) - 0x1f1e6 + 97))
                .join('');
        if (emoji.startsWith('🏴')) {
            const tag = [...emoji]
                .slice(1, -1)
                .map((char) => String.fromCharCode(char.codePointAt(0) - 0xe0000))
                .join('');
            return (
                { gbeng: 'gb-eng', gbsct: 'gb-sct', gbwls: 'gb-wls' }[tag] ||
                getRegionCode(identifyNodeRegion(emoji).region).toLowerCase()
            );
        }
        return '';
    });
    const image = computed(
        () =>
            `${import.meta.env.BASE_URL}flags/${failed.value || !code.value ? 'globe' : code.value}.svg`
    );
    const countryLabel = computed(() =>
        props.flag ? identifyNodeRegion(props.flag).region : props.region
    );
    watch(code, () => {
        failed.value = false;
    });
</script>
<template>
    <span class="inline-flex items-center gap-1.5 align-middle" :title="countryLabel">
        <img
            :src="image"
            :alt="countryLabel"
            width="24"
            height="18"
            class="inline-block h-[1em] w-[1.35em] shrink-0 rounded-[2px] object-contain align-middle"
            @error="failed = true"
        />
        <span v-if="label">{{ region }}</span>
    </span>
</template>
