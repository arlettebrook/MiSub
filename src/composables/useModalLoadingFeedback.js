import { inject, onScopeDispose, ref, watch } from 'vue';

export const modalLoadingFeedbackKey = Symbol('modal-loading-feedback');

// Code and data loading share one delay so changing stages never hides an
// indicator that has already appeared during this opening.
export function useModalLoadingFeedback(show, inherit = true) {
    const shared = inherit ? inject(modalLoadingFeedbackKey, null) : null;
    if (shared) return shared;

    const visible = ref(false);
    let timer;
    watch(
        show,
        (open) => {
            clearTimeout(timer);
            visible.value = false;
            if (open) timer = setTimeout(() => (visible.value = true), 150);
        },
        { immediate: true, flush: 'sync' }
    );
    onScopeDispose(() => clearTimeout(timer));
    return visible;
}
