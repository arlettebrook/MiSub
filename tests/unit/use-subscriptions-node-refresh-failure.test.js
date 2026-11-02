import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    subscriptionsRef: { value: [] },
    saveData: vi.fn(),
    showToast: vi.fn(),
    fetchNodeCount: vi.fn(),
    batchUpdateNodes: vi.fn(),
    handleError: vi.fn(),
}));

vi.mock('pinia', () => ({
    storeToRefs: () => ({
        subscriptions: mocks.subscriptionsRef,
    }),
}));

vi.mock('../../src/stores/useDataStore', () => ({
    useDataStore: () => ({
        saveData: mocks.saveData,
        settings: { autoUpdateInterval: 0 },
    }),
}));

vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({
        showToast: mocks.showToast,
    }),
}));

vi.mock('../../src/lib/api.js', () => ({
    fetchNodeCount: mocks.fetchNodeCount,
    batchUpdateNodes: mocks.batchUpdateNodes,
}));

vi.mock('../../src/utils/errorHandler.js', () => ({
    handleError: mocks.handleError,
}));

describe('useSubscriptions manual node refresh failures', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.subscriptionsRef.value = [];
        mocks.saveData.mockReset();
        mocks.showToast.mockReset();
        mocks.fetchNodeCount.mockReset();
        mocks.batchUpdateNodes.mockReset();
        mocks.handleError.mockReset();
    });

    it('clears stale node count and traffic when protective node cache is disabled', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.subscriptionsRef.value = [
            {
                id: 'sub-1',
                name: 'Airport',
                url: 'https://airport.example/sub',
                enabled: true,
                enableNodeCache: false,
                nodeCount: 86,
                userInfo: { upload: 1, download: 2, total: 100, expire: 999 },
            },
        ];
        mocks.fetchNodeCount.mockResolvedValue({
            success: false,
            error: 'HTTP 403: Forbidden',
            errorType: 'server',
            status: 403,
        });

        const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
        const markDirty = vi.fn();
        const { handleUpdateNodeCount } = useSubscriptions(markDirty);

        try {
            await handleUpdateNodeCount('sub-1');

            expect(mocks.subscriptionsRef.value[0].nodeCount).toBe(0);
            expect(mocks.subscriptionsRef.value[0].userInfo).toBeNull();
            expect(mocks.subscriptionsRef.value[0].lastError).toBe('HTTP 403: Forbidden');
            expect(errorSpy).toHaveBeenCalledWith(
                '[handleUpdateNodeCount] Failed for Airport:',
                'HTTP 403: Forbidden'
            );
            expect(markDirty).toHaveBeenCalledTimes(1);
            expect(mocks.saveData).toHaveBeenCalledTimes(1);
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('keeps stale node count and traffic when protective node cache is enabled', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const oldUserInfo = { upload: 1, download: 2, total: 100, expire: 999 };
        mocks.subscriptionsRef.value = [
            {
                id: 'sub-1',
                name: 'Airport',
                url: 'https://airport.example/sub',
                enabled: true,
                enableNodeCache: true,
                nodeCount: 86,
                userInfo: oldUserInfo,
            },
        ];
        mocks.fetchNodeCount.mockResolvedValue({
            success: false,
            error: 'HTTP 403: Forbidden',
            errorType: 'server',
            status: 403,
        });

        const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
        const markDirty = vi.fn();
        const { handleUpdateNodeCount } = useSubscriptions(markDirty);

        try {
            await handleUpdateNodeCount('sub-1');

            expect(mocks.subscriptionsRef.value[0].nodeCount).toBe(86);
            expect(mocks.subscriptionsRef.value[0].userInfo).toBe(oldUserInfo);
            expect(mocks.subscriptionsRef.value[0].lastError).toBe('HTTP 403: Forbidden');
            expect(errorSpy).toHaveBeenCalledWith(
                '[handleUpdateNodeCount] Failed for Airport:',
                'HTTP 403: Forbidden'
            );
            expect(markDirty).not.toHaveBeenCalled();
            expect(mocks.saveData).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('does not erase cached nodes when a background refresh is cancelled on hide', async () => {
        const original = {
            id: 'sub-1',
            name: 'Airport',
            url: 'https://airport.example/sub',
            enabled: true,
            nodeCount: 86,
            userInfo: { total: 100 },
        };
        mocks.subscriptionsRef.value = [original];
        mocks.fetchNodeCount.mockResolvedValue({ success: false, cancelled: true });
        const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
        const markDirty = vi.fn();
        await useSubscriptions(markDirty).handleUpdateNodeCount('sub-1', true);
        expect(original.nodeCount).toBe(86);
        expect(original.userInfo).toEqual({ total: 100 });
        expect(markDirty).not.toHaveBeenCalled();
        expect(mocks.saveData).not.toHaveBeenCalled();
        expect(mocks.fetchNodeCount.mock.calls[0][4]).toEqual({ background: true });
    });

    it('pauses scheduled refreshes while hidden and resumes without duplicating timers', async () => {
        vi.useFakeTimers();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
        const subscriptions = useSubscriptions(vi.fn());
        try {
            subscriptions.startAutoUpdate(1);
            expect(vi.getTimerCount()).toBe(1);
            visibility.mockReturnValue('hidden');
            document.dispatchEvent(new Event('visibilitychange'));
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(120000);
            expect(mocks.fetchNodeCount).not.toHaveBeenCalled();
            visibility.mockReturnValue('visible');
            document.dispatchEvent(new Event('visibilitychange'));
            document.dispatchEvent(new Event('visibilitychange'));
            expect(vi.getTimerCount()).toBe(1);
            window.dispatchEvent(new Event('pagehide'));
            expect(vi.getTimerCount()).toBe(0);
            window.dispatchEvent(new Event('pageshow'));
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            subscriptions.stopAutoUpdate();
            expect(vi.getTimerCount()).toBe(0);
            visibility.mockRestore();
            vi.useRealTimers();
        }
    });

    it('respects the disabled automatic refresh setting', async () => {
        vi.useFakeTimers();
        const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
        const subscriptions = useSubscriptions(vi.fn());
        try {
            subscriptions.startAutoUpdate();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            subscriptions.stopAutoUpdate();
            vi.useRealTimers();
        }
    });
});
