<script setup>
    import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
    import { useVersionStore } from '../../stores/version';
    import { useRoute } from 'vue-router';
    import { useFooterReveal } from '../../composables/useFooterReveal.js';
    import packageJson from '../../../package.json';

    defineProps({
        hideBranding: {
            type: Boolean,
            default: false,
        },
    });
    const emit = defineEmits(['visible-height']);

    const versionStore = useVersionStore();
    const route = useRoute();
    const { footer, isRevealed } = useFooterReveal(() => route.fullPath);
    let resizeObserver;
    const publishHeight = () => {
        const element = footer.value;
        const style = element ? getComputedStyle(element) : null;
        const height =
            isRevealed.value && element
                ? element.getBoundingClientRect().height +
                  (parseFloat(style.marginTop) || 0) +
                  (parseFloat(style.marginBottom) || 0)
                : 0;
        emit('visible-height', height);
    };
    watch(isRevealed, publishHeight, { flush: 'post' });
    onMounted(() => {
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(publishHeight);
            resizeObserver.observe(footer.value);
        }
    });
    onBeforeUnmount(() => {
        resizeObserver?.disconnect();
        emit('visible-height', 0);
    });
    const currentYear = computed(() => new Date().getFullYear());
    const currentVersion = packageJson.version;
</script>

<template>
    <footer
        ref="footer"
        v-show="isRevealed"
        tabindex="-1"
        class="w-full text-center p-8 border-t border-gray-200 dark:border-white/10 mt-8"
        :class="{ 'footer-revealed': isRevealed }"
    >
        <div
            class="flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500"
        >
            <p>
                <template v-if="!hideBranding">
                    Copyright © {{ currentYear }}
                    <a
                        href="https://github.com/arlettebrook/MiSub"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="font-semibold text-indigo-600/80 dark:text-indigo-400/80 hover:underline"
                    >
                        MiSUB </a
                    >. All Rights Reserved.
                </template>
                <template v-else> Copyright © {{ currentYear }}. All Rights Reserved. </template>
            </p>
            <button
                @click="versionStore.openModal"
                class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-[9px] font-mono hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors cursor-pointer opacity-80 hover:opacity-100 border border-transparent hover:border-indigo-500/30"
            >
                v{{ currentVersion }}
            </button>
        </div>
    </footer>
</template>

<style scoped>
    .footer-revealed {
        animation: footer-reveal 160ms ease-out;
    }

    @media (width >= 48rem) {
        .footer-revealed {
            margin-top: 0;
            padding: 1rem 2rem;
        }
    }

    @keyframes footer-reveal {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .footer-revealed {
            animation: none;
        }
    }
</style>
