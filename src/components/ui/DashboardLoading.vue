<script setup>
    import SkeletonLoader from './SkeletonLoader.vue';
</script>

<template>
    <SkeletonLoader
        type="dashboard"
        class="w-full"
        role="status"
        aria-live="polite"
        aria-busy="true"
    />
</template>
