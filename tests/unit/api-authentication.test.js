import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../../functions/modules/api-router.js';
import { createSignedToken } from '../../functions/modules/auth-middleware.js';
import { COOKIE_NAME, SESSION_DURATION } from '../../functions/modules/config.js';
import { SettingsCache } from '../../functions/storage-adapter.js';

const PRIVATE_ROUTES = [
    ['/settings', 'GET'],
    ['/settings', 'POST'],
    ['/settings/password', 'POST'],
    ['/settings/reset', 'POST'],
    ['/misubs', 'POST'],
    ['/dashboard/preferences', 'GET'],
    ['/dashboard/preferences', 'POST'],
    ['/rule_templates', 'POST'],
    ['/logs', 'GET'],
    ['/logs', 'DELETE'],
    ['/backup/export', 'GET'],
    ['/backup/restore', 'POST'],
    ['/backup/webdav/status', 'GET'],
    ['/backup/webdav/test', 'POST'],
    ['/backup/webdav/run', 'POST'],
    ['/backup/webdav/list', 'GET'],
    ['/backup/webdav/restore', 'POST'],
    ['/node_count', 'POST'],
    ['/nodes/health', 'POST'],
    ['/nodes/clean', 'POST'],
    ['/fetch_external_url', 'POST'],
    ['/batch_update_nodes', 'POST'],
    ['/subscription_nodes', 'POST'],
    ['/debug_subscription', 'POST'],
    ['/system/info', 'GET'],
    ['/system/storage_test', 'POST'],
    ['/system/export', 'POST'],
    ['/preview/content', 'POST'],
    ['/parse_subscription', 'POST'],
    ['/subconverter/test', 'POST'],
    ['/guestbook/manage', 'GET'],
    ['/guestbook/manage', 'POST'],
    ['/cron/status', 'GET'],
    ['/cron/trigger', 'POST'],
    ['/migrate', 'POST'],
    ['/migrate_to_d1', 'POST'],
    ['/detect_legacy_d1', 'GET'],
    ['/migrate_legacy_d1', 'POST'],
    ['/kv_test', 'GET'],
    ['/test_notification', 'POST'],
    ['/clients/init', 'POST'],
    ['/clients', 'POST'],
    ['/clients/client-id', 'DELETE'],
    ['/clients/private', 'GET'],
    ['/private_future_route', 'GET'],
    ['/public/private_future_route', 'GET'],
    ['/auth_debug', 'GET'],
    ['/auth_check', 'POST'],
];

function createEnv() {
    const values = new Map([
        [
            'worker_settings_v1',
            JSON.stringify({ FileName: 'private-filename', customLoginPath: 'admin-secret' }),
        ],
        ['misub_subscriptions_v1', JSON.stringify([{ id: 'private-subscription' }])],
    ]);
    return {
        COOKIE_SECRET: 'test-cookie-signing-secret',
        ADMIN_PASSWORD: 'test-admin-password',
        ENABLE_AUTH_DIAGNOSTICS: 'true',
        MISUB_KV: {
            async get(key) {
                return values.get(key) ?? null;
            },
            async put(key, value) {
                values.set(key, value);
            },
            async delete(key) {
                values.delete(key);
            },
        },
    };
}

function apiRequest(path, { method = 'GET', token, body } = {}) {
    const headers = new Headers({
        'X-MiSub-Path': '/admin-secret',
        Referer: 'https://example.com/admin-secret',
    });
    if (token) headers.set('Cookie', `${COOKIE_NAME}=${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const request = new Request(`https://example.com/api${path}`, { method, headers, body });
    // Model an incoming server request; happy-dom strips forbidden browser headers in the constructor.
    if (token) request.headers.set('Cookie', `${COOKIE_NAME}=${token}`);
    request.headers.set('Referer', 'https://example.com/admin-secret');
    return request;
}

beforeEach(() => SettingsCache.clear());
afterEach(() => vi.restoreAllMocks());

describe.each(['missing', 'forged', 'expired'])(
    'private API authentication with a %s cookie',
    (credential) => {
        it.each(PRIVATE_ROUTES)(
            'rejects %s (%s) before dispatching its handler',
            async (path, method) => {
                const env = createEnv();
                const token =
                    credential === 'expired'
                        ? await createSignedToken(
                              env.COOKIE_SECRET,
                              String(Date.now() - SESSION_DURATION - 1000)
                          )
                        : credential === 'forged'
                          ? 'not-a-signed-cookie'
                          : undefined;
                const settingsBefore = await env.MISUB_KV.get('worker_settings_v1');
                const subscriptionsBefore = await env.MISUB_KV.get('misub_subscriptions_v1');
                const response = await handleApiRequest(
                    apiRequest(path, {
                        method,
                        token,
                        body: method === 'POST' ? '{invalid json' : undefined,
                    }),
                    env
                );
                expect(response.status).toBe(401);
                expect(await response.json()).toEqual({ error: 'Unauthorized' });
                expect(response.headers.get('Location')).toBeNull();
                expect(response.headers.get('Cache-Control')).toContain('no-store');
                expect(await env.MISUB_KV.get('worker_settings_v1')).toBe(settingsBefore);
                expect(await env.MISUB_KV.get('misub_subscriptions_v1')).toBe(subscriptionsBefore);
            }
        );
    }
);

describe('request-by-request administrator validation', () => {
    it('rechecks a session after an earlier successful request and rejects it once it expires', async () => {
        const env = createEnv();
        const issuedAt = Date.now();
        const token = await createSignedToken(env.COOKIE_SECRET, String(issuedAt));
        const allowed = await handleApiRequest(apiRequest('/settings', { token }), env);
        expect(allowed.status).toBe(200);
        expect(await allowed.text()).toContain('private-filename');
        expect(allowed.headers.get('Cache-Control')).toContain('no-store');
        vi.spyOn(Date, 'now').mockReturnValue(issuedAt + SESSION_DURATION + 1);
        const denied = await handleApiRequest(apiRequest('/settings', { token }), env);
        expect(denied.status).toBe(401);
        const data = await handleApiRequest(apiRequest('/data', { token }), env);
        expect(await data.json()).toEqual({ authenticated: false, message: 'Not logged in' });
    });

    it('allows authenticated writes and rejects a following write without the login cookie', async () => {
        const env = createEnv();
        const token = await createSignedToken(env.COOKIE_SECRET, String(Date.now()));
        const saved = await handleApiRequest(
            apiRequest('/dashboard/preferences', {
                method: 'POST',
                token,
                body: JSON.stringify({ action: 'dismiss', id: 'subscription-errors:one' }),
            }),
            env
        );
        expect(saved.status).toBe(200);
        const denied = await handleApiRequest(
            apiRequest('/dashboard/preferences', {
                method: 'POST',
                body: JSON.stringify({ action: 'restore-all' }),
            }),
            env
        );
        expect(denied.status).toBe(401);
        const current = await handleApiRequest(
            apiRequest('/dashboard/preferences', { token }),
            env
        );
        expect((await current.json()).data.dismissedHealthItemIds).toEqual([
            'subscription-errors:one',
        ]);
    });

    it('requires a valid session for diagnostics even when the feature flag is enabled', async () => {
        const env = createEnv();
        const token = await createSignedToken(env.COOKIE_SECRET, String(Date.now()));
        const response = await handleApiRequest(apiRequest('/auth_debug', { token }), env);
        expect(response.status).toBe(200);
        expect((await response.json()).success).toBe(true);
    });

    it('keeps the published client list public while guarding its management paths', async () => {
        const env = createEnv();
        const published = await handleApiRequest(apiRequest('/clients'), env);
        expect(published.status).toBe(200);
        const management = await handleApiRequest(apiRequest('/clients/init'), env);
        expect(management.status).toBe(401);
    });
});
