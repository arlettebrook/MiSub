import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDataStore } from '../../src/stores/useDataStore.js';

const { showToast, apiGet, apiPost } = vi.hoisted(() => ({
    showToast: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
}));

vi.mock('../../src/stores/toast', () => ({ useToastStore: () => ({ showToast }) }));
vi.mock('../../src/lib/http.js', () => ({ api: { get: apiGet, post: apiPost } }));

const initialData = () => ({ misubs: [], profiles: [], ruleTemplates: [], config: {} });

beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.clearAllMocks();
    apiGet.mockReset();
    apiPost.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
});

describe('data store failure contract', () => {
    it.each(['fetchData', 'saveData'])(
        '%s reports a failure once without rejecting',
        async (action) => {
            const store = useDataStore();
            store.markDirty();
            apiGet.mockRejectedValue(new Error('network down'));
            apiPost.mockRejectedValue(new Error('network down'));

            await expect(store[action]()).resolves.toBe(false);

            expect(showToast).toHaveBeenCalledTimes(1);
            expect(showToast.mock.calls[0][1]).toBe('error');
            expect(store.isLoading).toBe(false);
            expect(store.saveState).toBe('idle');
            expect(store.isDirty).toBe(true);
            expect(store.hasDataLoaded).toBe(false);
        }
    );

    it.each(['fetchData', 'saveData'])(
        '%s returns false silently on cancellation',
        async (action) => {
            const cancelled = Object.assign(new Error('page closed'), { cancelled: true });
            apiGet.mockRejectedValue(cancelled);
            apiPost.mockRejectedValue(cancelled);
            const store = useDataStore();
            store.markDirty();

            await expect(store[action]()).resolves.toBe(false);

            expect(showToast).not.toHaveBeenCalled();
            expect(store.isLoading).toBe(false);
            expect(store.saveState).toBe('idle');
            expect(store.isDirty).toBe(true);
        }
    );

    it('handles an API error response without rejecting', async () => {
        apiGet.mockResolvedValue({ error: 'storage unavailable' });
        await expect(useDataStore().fetchData()).resolves.toBe(false);
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('handles an unsuccessful save response without rejecting', async () => {
        apiPost.mockResolvedValue({ success: false, message: 'storage unavailable' });
        await expect(useDataStore().saveData()).resolves.toBe(false);
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it.each(['fetchData', 'saveData'])('%s handles non-Error rejection reasons', async (action) => {
        apiGet.mockRejectedValue(null);
        apiPost.mockRejectedValue(null);
        await expect(useDataStore()[action]()).resolves.toBe(false);
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('does not clear pending changes when response hydration fails', async () => {
        apiGet.mockResolvedValue({ ...initialData(), misubs: {} });
        const store = useDataStore();
        store.markDirty();
        await expect(store.fetchData()).resolves.toBe(false);
        expect(store.isDirty).toBe(true);
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('falls back to the API when cached data cannot be hydrated', async () => {
        sessionStorage.setItem(
            'misub_data_cache',
            JSON.stringify({ ...initialData(), misubs: {} })
        );
        sessionStorage.setItem('misub_data_cache_ts', String(Date.now()));
        apiGet.mockResolvedValue(initialData());
        await expect(useDataStore().fetchData()).resolves.toBe(true);
        expect(apiGet).toHaveBeenCalledTimes(1);
    });

    it('returns true after loading data and when reusing loaded data', async () => {
        apiGet.mockResolvedValue(initialData());
        const store = useDataStore();
        store.markDirty();

        await expect(store.fetchData()).resolves.toBe(true);
        expect(store.isDirty).toBe(false);
        await expect(store.fetchData()).resolves.toBe(true);
        expect(apiGet).toHaveBeenCalledTimes(1);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('returns true when loading cached data', async () => {
        useDataStore().hydrateFromData(initialData());
        setActivePinia(createPinia());

        await expect(useDataStore().fetchData()).resolves.toBe(true);
        expect(apiGet).not.toHaveBeenCalled();
    });

    it('returns false while another request is in progress', async () => {
        let finish;
        apiGet.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const store = useDataStore();
        const pending = store.fetchData();

        await expect(store.fetchData()).resolves.toBe(false);
        await expect(store.saveData()).resolves.toBe(false);
        expect(apiGet).toHaveBeenCalledTimes(1);
        expect(apiPost).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
        finish(initialData());
        await pending;
        expect(store.isLoading).toBe(false);
    });

    it('returns true after saving and clears pending changes', async () => {
        const store = useDataStore();
        store.addSubscription({ id: 's1', enabled: true, isUpdating: true });
        apiPost.mockResolvedValue({
            success: true,
            data: { misubs: [{ id: 's1', enabled: true }] },
        });

        await expect(store.saveData()).resolves.toBe(true);
        expect(apiPost.mock.calls[0][1].misubs[0]).not.toHaveProperty('isUpdating');
        expect(store.isDirty).toBe(false);
        expect(store.isLoading).toBe(false);
        expect(store.saveState).toBe('success');
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast.mock.calls[0][1]).toBe('success');
        await vi.advanceTimersByTimeAsync(2000);
        expect(store.saveState).toBe('idle');
    });
});
