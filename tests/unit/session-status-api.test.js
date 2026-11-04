import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../../functions/modules/api-router.js';
import * as auth from '../../functions/modules/auth-middleware.js';
import { COOKIE_NAME, SESSION_DURATION } from '../../functions/modules/config.js';
import { SettingsCache } from '../../functions/storage-adapter.js';

function env() {
    const values = new Map([
        [
            'worker_settings_v1',
            JSON.stringify({ FileName: 'private-name', customLoginPath: 'private-entry' }),
        ],
    ]);
    return {
        COOKIE_SECRET: 'session-status-test-key',
        MISUB_KV: {
            async get(key) {
                return values.get(key) ?? null;
            },
            async put(key, value) {
                values.set(key, value);
            },
        },
    };
}
function request(token) {
    const value = new Request('https://example.com/api/session');
    if (token) value.headers.set('Cookie', `${COOKIE_NAME}=${token}`);
    return value;
}
beforeEach(() => SettingsCache.clear());
afterEach(() => vi.restoreAllMocks());

describe('lightweight session verification', () => {
    it.each(['missing', 'forged', 'expired', 'valid'])(
        'returns only the authentication state for a %s cookie',
        async (state) => {
            const environment = env();
            let token;
            if (state === 'forged') token = 'not-a-signed-cookie';
            if (state === 'expired' || state === 'valid') {
                token = await auth.createSignedToken(
                    environment.COOKIE_SECRET,
                    String(Date.now() - (state === 'expired' ? SESSION_DURATION + 1000 : 0))
                );
            }
            const response = await handleApiRequest(request(token), environment);
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ authenticated: state === 'valid' });
            expect(response.headers.get('Cache-Control')).toContain('no-store');
        }
    );

    it('reports verification unavailability without claiming the session expired', async () => {
        vi.spyOn(auth, 'getAuthSessionDiagnostic').mockRejectedValue(
            new Error('storage unavailable')
        );
        const response = await handleApiRequest(request('cookie'), env());
        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).not.toHaveProperty('authenticated');
        expect(JSON.stringify(body)).not.toContain('storage unavailable');
    });
});
