import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    confirmAction,
    registerConfirmHost,
    settleConfirm,
    useConfirm,
    useConfirmState,
} from '../../src/composables/useConfirm.js';

let unregisterHost;
beforeEach(() => {
    unregisterHost = registerConfirmHost();
});
afterEach(() => {
    settleConfirm(false);
    unregisterHost();
    vi.restoreAllMocks();
});

describe('confirmation request lifecycle', () => {
    it('resolves approval once and clears the request', async () => {
        const result = confirmAction({ message: 'Delete?', variant: 'danger' });
        const request = useConfirmState().value;
        expect(request.variant).toBe('danger');
        request.listeners.confirm();
        request.listeners['update:show'](false);
        await expect(result).resolves.toBe(true);
        expect(useConfirmState().value).toBeNull();
    });

    it('cancels an older request and ignores its late events', async () => {
        const first = confirmAction({ message: 'First' });
        const previous = useConfirmState().value;
        const second = confirmAction({ message: 'Second' });
        const current = useConfirmState().value;
        await expect(first).resolves.toBe(false);
        previous.listeners.confirm();
        previous.listeners['update:show'](false);
        expect(useConfirmState().value.id).toBe(current.id);
        current.listeners.confirm();
        await expect(second).resolves.toBe(true);
    });

    it('releases a request when its signal is aborted', async () => {
        const controller = new AbortController();
        const result = confirmAction({ message: 'Restore?', signal: controller.signal });
        controller.abort();
        await expect(result).resolves.toBe(false);
        expect(useConfirmState().value).toBeNull();
    });

    it('does not replace an active request with a request that was already cancelled', async () => {
        const current = confirmAction({ message: 'Keep this dialog' });
        const id = useConfirmState().value.id;
        const controller = new AbortController();
        controller.abort();
        await expect(confirmAction({ signal: controller.signal })).resolves.toBe(false);
        expect(useConfirmState().value.id).toBe(id);
        settleConfirm(false);
        await current;
    });

    it('cancels pending requests when the caller scope is disposed', async () => {
        const scope = effectScope();
        const caller = scope.run(() => useConfirm());
        const result = caller.confirmAction({ message: 'Restore?' });
        scope.stop();
        await expect(result).resolves.toBe(false);
        await expect(caller.confirmAction({ message: 'Too late' })).resolves.toBe(false);
    });

    it('removes a completed request from its caller signal', async () => {
        const controller = new AbortController();
        const first = confirmAction({ signal: controller.signal });
        settleConfirm(true);
        await first;
        const second = confirmAction({ message: 'Second' });
        const id = useConfirmState().value.id;
        controller.abort();
        expect(useConfirmState().value.id).toBe(id);
        settleConfirm(true);
        await expect(second).resolves.toBe(true);
    });

    it('cancels a hidden caller and permits confirmation after it opens again', async () => {
        const visible = ref(true);
        const scope = effectScope();
        const caller = scope.run(() => useConfirm({ enabled: () => visible.value }));
        const first = caller.confirmAction({ message: 'First' });
        visible.value = false;
        await expect(first).resolves.toBe(false);
        await expect(caller.confirmAction({ message: 'Hidden' })).resolves.toBe(false);
        visible.value = true;
        const second = caller.confirmAction({ message: 'Second' });
        settleConfirm(true);
        await expect(second).resolves.toBe(true);
        scope.stop();
    });

    it('releases waiters when the last host unmounts', async () => {
        const result = confirmAction({ message: 'Continue?' });
        unregisterHost();
        unregisterHost();
        await expect(result).resolves.toBe(false);
    });

    it.each([true, false])('uses the native fallback without a host (%s)', async (accepted) => {
        unregisterHost();
        const original = window.confirm;
        const native = vi.fn(() => accepted);
        window.confirm = native;
        try {
            await expect(confirmAction({ message: 'Continue?' })).resolves.toBe(accepted);
            expect(native).toHaveBeenCalledWith('Continue?');
            expect(useConfirmState().value).toBeNull();
        } finally {
            window.confirm = original;
        }
    });
});
