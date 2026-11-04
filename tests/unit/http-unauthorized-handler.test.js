import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureUnauthorizedHandler, request } from '../../src/lib/http.js';

beforeEach(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    configureUnauthorizedHandler(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('HTTP unauthorized handling', () => {
    it('notifies the application before rejecting an expired-session request', async () => {
        fetch.mockResolvedValue(
            new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        );
        const handler = vi.fn();
        configureUnauthorizedHandler(handler);
        await expect(request('/api/settings')).rejects.toMatchObject({
            name: 'APIError',
            status: 401,
        });
        expect(handler).toHaveBeenCalledExactlyOnceWith({
            url: '/api/settings',
            data: { error: 'Unauthorized' },
        });
    });

    it.each([200, 403, 500])('does not expire the session on HTTP %s', async (status) => {
        fetch.mockResolvedValue(new Response('{}', { status }));
        const handler = vi.fn();
        configureUnauthorizedHandler(handler);
        await request('/api/settings').catch(() => {});
        expect(handler).not.toHaveBeenCalled();
    });

    it('preserves the API error when the notification handler throws', async () => {
        fetch.mockResolvedValue(new Response('{}', { status: 401 }));
        configureUnauthorizedHandler(() => {
            throw new Error('handler failed');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(request('/api/settings')).rejects.toMatchObject({
            name: 'APIError',
            status: 401,
        });
    });
});
