import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../src/lib/http.js', () => ({
    api: { get: mocks.get, post: mocks.post },
    APIError: class APIError extends Error {},
}));

beforeEach(() => {
    vi.useFakeTimers();
    mocks.get.mockReset();
    mocks.post.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe.each([
    ['fetchInitialData', 'get', []],
    ['fetchNodeCount', 'post', ['https://example.com/sub']],
    ['batchUpdateNodes', 'post', [['sub-1']]],
    ['testSubconverterBackend', 'post', ['https://converter.example']],
])('%s timeout cleanup', (name, method, args) => {
    it.each(['success', 'failure', 'cancelled'])(
        'releases the timeout after %s without aborting later',
        async (outcome) => {
            if (outcome === 'success') mocks[method].mockResolvedValue({ success: true });
            else {
                const error = new Error('network down');
                if (outcome === 'cancelled') error.cancelled = true;
                mocks[method].mockRejectedValue(error);
            }
            const apiModule = await import('../../src/lib/api.js');
            const result = await apiModule[name](...args);
            const options = mocks[method].mock.calls[0].at(-1);

            expect(result.success).toBe(outcome === 'success');
            if (outcome === 'cancelled') expect(result.cancelled).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(120000);
            expect(options.signal.aborted).toBe(false);
        }
    );
});
