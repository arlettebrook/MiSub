import { onMounted, onScopeDispose, ref, watch } from 'vue';
import { createNavigationPreloader } from '../router/navigation-preloader.js';

export function useIdlePreload(ready, loaders) {
    const mounted = ref(false);
    const visible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const preloader = createNavigationPreloader({ loaders });
    const updateVisibility = () => {
        visible.value = document.visibilityState !== 'hidden';
    };
    watch(
        [mounted, visible, ready],
        ([isMounted, isVisible, isReady]) => {
            if (isMounted && isVisible && isReady) preloader.start();
            else preloader.stop();
        },
        { immediate: true, flush: 'post' }
    );
    onMounted(() => {
        mounted.value = true;
        document.addEventListener('visibilitychange', updateVisibility);
    });
    onScopeDispose(() => {
        preloader.stop();
        document.removeEventListener('visibilitychange', updateVisibility);
    });
}
