import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicConfig } from '../../src/lib/api.js';
import { cancelPendingRequests } from '../../src/lib/http.js';

beforeEach(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
    cancelPendingRequests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('public config request context and timeout', () => {
    it('sends the requested page path for server-side login entry confirmation', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(new Response('{"isLoginPath":true}', { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        await expect(fetchPublicConfig('/admin-login')).resolves.toMatchObject({
            success: true,
            data: { isLoginPath: true },
        });
        expect(fetch.mock.calls[0][1].headers.get('X-MiSub-Path')).toBe('/admin-login');
    });

    it('uses the current page path by default', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        await fetchPublicConfig();
        expect(fetch.mock.calls[0][1].headers.get('X-MiSub-Path')).toBe(window.location.pathname);
    });

    it('aborts a stalled request after eight seconds and releases its timer', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_url, options) =>
                    new Promise((_resolve, reject) => {
                        options.signal.addEventListener(
                            'abort',
                            () => reject(options.signal.reason),
                            { once: true }
                        );
                    })
            )
        );
        const pending = fetchPublicConfig('/admin-login');
        await vi.advanceTimersByTimeAsync(8000);
        await expect(pending).resolves.toMatchObject({ success: false, errorType: 'timeout' });
        expect(vi.getTimerCount()).toBe(0);
    });
});
