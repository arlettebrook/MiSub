import { reactive, watch } from 'vue';

// Mount on the first opening, then retain the instance for closing transitions and reuse.
export function useLazyModals(modals) {
    const mounted = reactive(new Set());
    const entries = Object.entries(modals);
    watch(
        entries.map(([, visible]) => visible),
        (visibility) => {
            entries.forEach(([name], index) => {
                if (visibility[index]) mounted.add(name);
            });
        },
        { immediate: true, flush: 'sync' }
    );
    return mounted;
}
