import { getCurrentScope, onScopeDispose, readonly, shallowRef, watch } from 'vue';

const pending = shallowRef(null);
let activeRequest = null;
let nextRequestId = 0;
let hostCount = 0;

export function settleConfirm(accepted, requestId = activeRequest?.id) {
    if (!activeRequest || activeRequest.id !== requestId) return;
    const request = activeRequest;
    activeRequest = null;
    pending.value = null;
    request.cleanup();
    request.resolve(Boolean(accepted));
}

export function registerConfirmHost() {
    hostCount++;
    let registered = true;
    return () => {
        if (!registered) return;
        registered = false;
        hostCount--;
        if (hostCount === 0) settleConfirm(false);
    };
}

export function useConfirmState() {
    return readonly(pending);
}

export function confirmAction(options = {}) {
    const { signal } = options;
    if (signal?.aborted) return Promise.resolve(false);
    if (hostCount === 0) {
        return Promise.resolve(
            typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? Boolean(window.confirm(options.message || ''))
                : false
        );
    }

    settleConfirm(false);
    return new Promise((resolve) => {
        const id = ++nextRequestId;
        const cancel = () => settleConfirm(false, id);
        activeRequest = {
            id,
            signal,
            resolve,
            cleanup: () => signal?.removeEventListener('abort', cancel),
        };
        signal?.addEventListener('abort', cancel, { once: true });
        pending.value = {
            id,
            title: options.title || '',
            message: options.message || '',
            confirmText: options.confirmText || '',
            cancelText: options.cancelText || '',
            variant: options.variant === 'danger' ? 'danger' : 'primary',
            listeners: {
                confirm: () => settleConfirm(true, id),
                'update:show': cancel,
            },
        };
    });
}

// Cancel requests belonging to a page or component that has gone away.
export function useConfirm({ enabled } = {}) {
    const controller = new AbortController();
    if (getCurrentScope()) {
        onScopeDispose(() => controller.abort());
        if (enabled)
            watch(
                enabled,
                (visible) => {
                    if (!visible && activeRequest?.signal === controller.signal)
                        settleConfirm(false);
                },
                { flush: 'sync' }
            );
    }
    return {
        confirmAction: (options = {}) =>
            enabled && !enabled()
                ? Promise.resolve(false)
                : confirmAction({ ...options, signal: controller.signal }),
    };
}
