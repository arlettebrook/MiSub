import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    request,
    cancelPrivateRequests,
    configureSessionRequestGuard,
    configureConnectionErrorHandler,
    RequestCancelledError,
} from '../../src/lib/http.js';

let releases;
beforeEach(() => {
    releases = [];
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
    releases.forEach((release) => release());
    cancelPrivateRequests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('management request session policy', () => {
    it('blocks private reads and writes while allowing public reads and verification requests', async () => {
        releases.push(configureSessionRequestGuard(() => false));
        fetch.mockResolvedValue(new Response('{}'));
        await expect(request('/api/settings')).rejects.toBeInstanceOf(RequestCancelledError);
        await expect(request('/api/misubs', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(
            RequestCancelledError
        );
        expect(fetch).not.toHaveBeenCalled();
        await request('/api/public_config');
        fetch.mockResolvedValue(new Response('{}'));
        await request('/api/session', { sessionCheck: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('cancels private requests after logout without cancelling public requests', async () => {
        fetch.mockImplementation(
            (_url, options) =>
                new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(options.signal.reason));
                })
        );
        const privateRead = request('/api/settings');
        fetch.mockResolvedValueOnce(new Response('{}'));
        const publicRead = request('/api/public_config');
        const cancelled = expect(privateRead).rejects.toBeInstanceOf(RequestCancelledError);
        cancelPrivateRequests();
        await cancelled;
        await expect(publicRead).resolves.toEqual({});
    });

    it.each([new TypeError('Failed to fetch'), { status: 503, message: 'unavailable' }])(
        'reports private connection failures for verification (%j)',
        async (failure) => {
            const handler = vi.fn();
            releases.push(configureConnectionErrorHandler(handler));
            if (failure.status)
                fetch.mockResolvedValue(new Response('{}', { status: failure.status }));
            else fetch.mockRejectedValue(failure);
            await request('/api/settings').catch(() => {});
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].url).toBe('/api/settings');
        }
    );

    it('does not treat public endpoint failure or permission denial as a disconnected management session', async () => {
        const handler = vi.fn();
        releases.push(configureConnectionErrorHandler(handler));
        fetch.mockResolvedValue(new Response('{}', { status: 503 }));
        await request('/api/github/release').catch(() => {});
        fetch.mockResolvedValue(new Response('{}', { status: 403 }));
        await request('/api/settings').catch(() => {});
        expect(handler).not.toHaveBeenCalled();
    });
});
