import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    request,
    cancelPendingRequests,
    configureUnauthorizedHandler,
    RequestCancelledError,
} from '../../src/lib/http.js';
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
    configureUnauthorizedHandler(null);
    configureErrorMonitoring({ endpoint: null });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('HTTP page lifecycle', () => {
    it('reads the current session instead of reusing a login response from browser history', async () => {
        let authenticated = true;
        let cachedResponse;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url, options) => {
                if (cachedResponse && options.cache !== 'no-store') return cachedResponse.clone();
                const response = new Response(JSON.stringify({ authenticated }), { status: 200 });
                cachedResponse = response.clone();
                return response;
            })
        );
        expect(await request('/api/data')).toEqual({ authenticated: true });
        authenticated = false;
        expect(await request('/api/data')).toEqual({ authenticated: false });
    });

    it('does not expire the session when a cancelled request finishes parsing a 401 response', async () => {
        let finishText;
        const response = new Response('{}', { status: 401 });
        const text = vi.spyOn(response, 'text').mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishText = resolve;
                })
        );
        const unauthorized = vi.fn();
        configureUnauthorizedHandler(unauthorized);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        const pending = request('/api/dashboard/preferences', { background: true });
        const cancelled = expect(pending).rejects.toBeInstanceOf(RequestCancelledError);
        await vi.waitFor(() => expect(text).toHaveBeenCalled());
        cancelPendingRequests(true);
        finishText('{"error":"Unauthorized"}');
        await cancelled;
        expect(unauthorized).not.toHaveBeenCalled();
    });

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
