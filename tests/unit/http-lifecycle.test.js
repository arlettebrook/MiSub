import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, cancelPendingRequests, RequestCancelledError } from '../../src/lib/http.js';
import { ErrorHandler, configureErrorMonitoring } from '../../src/utils/errorHandler.js';

const pendingFetch = (_url, options) =>
    new Promise((_resolve, reject) => {
        if (options.signal.aborted) reject(options.signal.reason);
        else
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                once: true,
            });
    });

beforeEach(() => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'));
afterEach(() => {
    cancelPendingRequests();
    configureErrorMonitoring({ endpoint: null });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('HTTP page lifecycle', () => {
    it('cancels in-flight requests when the page closes', async () => {
        const fetch = vi.fn(pendingFetch);
        vi.stubGlobal('fetch', fetch);
        const result = request('/api/data');
        const cancelled = expect(result).rejects.toBeInstanceOf(RequestCancelledError);
        window.dispatchEvent(new Event('pagehide'));
        await cancelled;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('cancels background checks while preserving a foreground operation on hide', async () => {
        const fetch = vi.fn(pendingFetch);
        vi.stubGlobal('fetch', fetch);
        const background = request('/api/github/release', { background: true });
        const foreground = request('/api/settings');
        const backgroundCancelled =
            expect(background).rejects.toBeInstanceOf(RequestCancelledError);
        const foregroundCancelled =
            expect(foreground).rejects.toBeInstanceOf(RequestCancelledError);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await backgroundCancelled;
        expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
        await expect(request('/api/monitor', { background: true })).rejects.toBeInstanceOf(
            RequestCancelledError
        );
        expect(fetch).toHaveBeenCalledTimes(2);
        window.dispatchEvent(new Event('pagehide'));
        await foregroundCancelled;
    });

    it('preserves caller cancellation and releases its timeout after completion', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(pendingFetch));
        const controller = new AbortController();
        const result = request('/api/data', { signal: controller.signal, timeoutMs: 8000 });
        const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await cancelled;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not leave a timer behind after a network failure', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(request('/api/data', { timeoutMs: 8000 })).rejects.toThrow('Failed to fetch');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses cancelable monitoring instead of keeping a report alive after closing', async () => {
        const fetch = vi.fn(pendingFetch);
        vi.stubGlobal('fetch', fetch);
        const beacon = vi.fn();
        vi.stubGlobal('navigator', { sendBeacon: beacon, userAgent: 'Test browser' });
        configureErrorMonitoring({ endpoint: '/api/monitor' });
        const report = new ErrorHandler().sendToMonitoringService({ message: 'Test error' });
        expect(fetch.mock.calls[0][1].keepalive).toBeUndefined();
        window.dispatchEvent(new Event('pagehide'));
        await report;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(beacon).not.toHaveBeenCalled();
    });
});
