import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../../src/constants/timing.js';

const mocks = vi.hoisted(() => ({
    dataStore: { settings: {} },
    subscriptionsRef: { value: [] },
}));

vi.mock('pinia', () => ({
    storeToRefs: () => ({ subscriptions: mocks.subscriptionsRef }),
}));
vi.mock('../../src/stores/useDataStore', () => ({ useDataStore: () => mocks.dataStore }));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../src/lib/api.js', () => ({
    fetchNodeCount: vi.fn(),
    batchUpdateNodes: vi.fn(),
}));
vi.mock('../../src/utils/errorHandler.js', () => ({ handleError: vi.fn() }));

let subscriptions;

beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    mocks.dataStore.settings = {};
    const { useSubscriptions } = await import('../../src/composables/useSubscriptions.js');
    subscriptions = useSubscriptions(vi.fn());
});

afterEach(() => {
    subscriptions.stopAutoUpdate();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('subscription auto-update interval settings', () => {
    it.each([0, '0'])('disables existing timers when the setting is %s', (interval) => {
        subscriptions.startAutoUpdate(5);
        expect(vi.getTimerCount()).toBe(1);
        mocks.dataStore.settings.autoUpdateInterval = interval;
        subscriptions.startAutoUpdate();
        expect(vi.getTimerCount()).toBe(0);
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
        expect(vi.getTimerCount()).toBe(0);
        subscriptions.startAutoUpdate(5);
        subscriptions.restartAutoUpdate(interval);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([5, '5'])('schedules a positive interval %s in minutes', (interval) => {
        mocks.dataStore.settings.autoUpdateInterval = interval;
        const setInterval = vi.spyOn(globalThis, 'setInterval');
        subscriptions.startAutoUpdate();
        subscriptions.startAutoUpdate(interval);
        expect(setInterval).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 5 * 60 * 1000);
    });

    it.each([undefined, null, -1, 'invalid', NaN, Infinity, 'Infinity'])(
        'uses the default interval for invalid setting %s',
        (interval) => {
            mocks.dataStore.settings.autoUpdateInterval = interval;
            const setInterval = vi.spyOn(globalThis, 'setInterval');
            subscriptions.startAutoUpdate();
            expect(setInterval).toHaveBeenCalledExactlyOnceWith(
                expect.any(Function),
                TIMING.AUTO_UPDATE_INTERVAL_MS
            );
            subscriptions.stopAutoUpdate();
            setInterval.mockClear();
            subscriptions.restartAutoUpdate(interval);
            expect(setInterval).toHaveBeenCalledExactlyOnceWith(
                expect.any(Function),
                TIMING.AUTO_UPDATE_INTERVAL_MS
            );
        }
    );
});
