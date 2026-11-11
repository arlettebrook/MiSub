import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../functions/modules/api-router.js';

function createKv(initial = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]) => [
            key,
            typeof value === 'string' ? value : JSON.stringify(value),
        ])
    );
    return {
        async get(key) {
            return values.get(key) ?? null;
        },
        async put(key, value) {
            values.set(key, value);
        },
        async delete(key) {
            values.delete(key);
        },
    };
}

function createEnv({ settings = {}, subscriptions = [], profiles = [] } = {}) {
    return {
        MISUB_KV: createKv({
            worker_settings_v1: {
                externalApi: { enabled: true, tokens: [{ name: 'default', token: 'misub_ok' }] },
                ...settings,
            },
            misub_subscriptions_v1: subscriptions,
            misub_profiles_v1: profiles,
        }),
        COOKIE_SECRET: 'stable-cookie-secret',
        ADMIN_PASSWORD: 'secret-password',
    };
}

function createRequest(path, { method = 'GET', body } = {}) {
    return new Request(`https://example.com/api/ext/v1${path}`, {
        method,
        headers: {
            Authorization: 'Bearer misub_ok',
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe('external subscriptions handler', () => {
    it.each(['POST', 'PATCH'])(
        'rejects invalid UA before trimming or saving it through %s',
        async (method) => {
            const existing = {
                id: 'sub-1',
                name: 'Airport',
                url: 'https://example.com/sub',
                customUserAgent: 'clash-verge/v2.4.3',
            };
            const env = createEnv({ subscriptions: [existing] });
            const before = await env.MISUB_KV.get('misub_subscriptions_v1');
            const response = await handleApiRequest(
                createRequest(method === 'POST' ? '/subscriptions' : '/subscriptions/sub-1', {
                    method,
                    body: { name: 'Airport', url: 'https://example.com/sub', userAgent: '\r\n' },
                }),
                env
            );
            expect(response.status).toBe(400);
            expect((await response.json()).error.code).toBe('invalid_user_agent');
            expect(await env.MISUB_KV.get('misub_subscriptions_v1')).toBe(before);
        }
    );

    it('retains an old UA when patching unrelated subscription fields', async () => {
        const env = createEnv({
            subscriptions: [
                {
                    id: 'sub-1',
                    name: 'Airport',
                    url: 'https://example.com/sub',
                    customUserAgent: 'clash-verge/v2.4.3',
                },
            ],
        });
        const response = await handleApiRequest(
            createRequest('/subscriptions/sub-1', { method: 'PATCH', body: { name: 'New name' } }),
            env
        );
        expect(response.status).toBe(200);
        expect((await response.json()).data.userAgent).toBe('clash-verge/v2.4.3');
    });
    it('lists only remote subscriptions on /subscriptions', async () => {
        const env = createEnv({
            subscriptions: [
                {
                    id: 'sub-1',
                    name: 'Airport A',
                    url: 'https://example.com/sub-a',
                    enabled: true,
                    group: 'A',
                },
                {
                    id: 'node-1',
                    name: 'HK 01',
                    url: 'vless://uuid@example.com:443#HK01',
                    enabled: true,
                    group: 'HK',
                },
            ],
        });

        const response = await handleApiRequest(createRequest('/subscriptions'), env);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({ id: 'sub-1', type: 'subscription' });
        expect(body.data[0]).not.toHaveProperty('protocol');
    });

    it('creates a remote subscription and rejects node protocols on subscription endpoints', async () => {
        const env = createEnv();

        const created = await handleApiRequest(
            createRequest('/subscriptions', {
                method: 'POST',
                body: { name: 'Airport B', url: 'https://example.com/sub-b' },
            }),
            env
        );
        const createdBody = await created.json();

        expect(created.status).toBe(201);
        expect(createdBody.data).toMatchObject({
            type: 'subscription',
            name: 'Airport B',
            url: 'https://example.com/sub-b',
        });

        const invalid = await handleApiRequest(
            createRequest('/subscriptions', {
                method: 'POST',
                body: { name: 'Bad Node', url: 'vless://uuid@example.com:443#Bad' },
            }),
            env
        );
        const invalidBody = await invalid.json();

        expect(invalid.status).toBe(400);
        expect(invalidBody.error.code).toBe('invalid_subscription_url');
    });

    it('deletes subscriptions and removes them from profile subscription references', async () => {
        const env = createEnv({
            subscriptions: [
                { id: 'sub-1', name: 'Airport A', url: 'https://example.com/sub-a', enabled: true },
                { id: 'sub-2', name: 'Airport B', url: 'https://example.com/sub-b', enabled: true },
            ],
            profiles: [
                { id: 'profile-1', name: 'Main', subscriptions: ['sub-1'], manualNodes: [] },
                {
                    id: 'profile-2',
                    name: 'Backup',
                    subscriptions: ['sub-1', 'sub-2'],
                    manualNodes: [],
                },
            ],
        });

        const response = await handleApiRequest(
            createRequest('/subscriptions/sub-1', { method: 'DELETE' }),
            env
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.deleted).toBe(true);
        expect(body.data.removedFromProfiles).toEqual(['profile-1', 'profile-2']);

        const profilesResponse = await handleApiRequest(createRequest('/profiles'), env);
        const profilesBody = await profilesResponse.json();
        expect(profilesBody.data).toEqual([
            expect.objectContaining({ id: 'profile-1', subscriptionIds: [], manualNodeIds: [] }),
            expect.objectContaining({
                id: 'profile-2',
                subscriptionIds: ['sub-2'],
                manualNodeIds: [],
            }),
        ]);
    });
});
