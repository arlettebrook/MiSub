import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    handleDashboardPreferencesRequest,
    DASHBOARD_PREFERENCES_KEY,
} from '../../functions/modules/dashboard-preferences-handler.js';
import { SettingsCache } from '../../functions/storage-adapter.js';

function createKV(initial = {}) {
    const data = new Map(
        Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)])
    );
    return {
        data,
        get: async (key) => data.get(key) ?? null,
        put: async (key, value) => {
            data.set(key, value);
        },
        delete: async (key) => {
            data.delete(key);
        },
    };
}
function request(body, method = 'POST') {
    return new Request('https://example.com/api/dashboard/preferences', {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
let kv;
beforeEach(() => {
    SettingsCache.clear();
    kv = createKV();
});
afterEach(() => {
    vi.restoreAllMocks();
    SettingsCache.clear();
});
const send = async (body, method = 'POST') => {
    const response = await handleDashboardPreferencesRequest(request(body, method), {
        MISUB_KV: kv,
    });
    return { response, body: await response.json() };
};

describe('dashboard preference persistence handler', () => {
    it('reads fresh preferences without public or browser caching', async () => {
        const { response, body } = await send(undefined, 'GET');
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(body).toEqual({
            success: true,
            initialized: false,
            data: { dismissedHealthItemIds: [] },
        });
    });

    it('persists individual changes while retaining other devices’ ignored items', async () => {
        await send({ action: 'dismiss', id: 'subscription-errors:one' });
        await send({ action: 'dismiss', id: 'low-traffic:two' });
        await send({ action: 'dismiss', id: 'subscription-errors:one' });
        await send({ action: 'restore', id: 'subscription-errors:one' });
        const { body } = await send(undefined, 'GET');
        expect(body.data.dismissedHealthItemIds).toEqual(['low-traffic:two']);
        expect(JSON.parse(kv.data.get(DASHBOARD_PREFERENCES_KEY))).toEqual({
            dismissedHealthItemIds: ['low-traffic:two'],
        });
        expect(kv.data.size).toBe(1);
    });

    it('does not let migration overwrite previously saved or restored server preferences', async () => {
        await send({ action: 'migrate', ids: ['auto-token', 'auto-token'] });
        expect((await send(undefined, 'GET')).body.data.dismissedHealthItemIds).toEqual([
            'auto-token',
        ]);
        await send({ action: 'restore-all' });
        await send({ action: 'migrate', ids: ['auto-token'] });
        expect((await send(undefined, 'GET')).body).toEqual({
            success: true,
            initialized: true,
            data: { dismissedHealthItemIds: [] },
        });
    });

    it.each([
        { action: 'invalid' },
        { action: 'dismiss', id: '' },
        { action: 'restore', id: 1 },
        { action: 'migrate', ids: {} },
        { action: 'migrate', ids: ['valid', null] },
        { action: 'dismiss', id: 'a'.repeat(513) },
    ])('rejects invalid mutations before modifying storage: %j', async (mutation) => {
        const { response } = await send(mutation);
        expect(response.status).toBe(400);
        expect(kv.data.size).toBe(0);
    });

    it('does not silently drop existing ignored items at the capacity limit', async () => {
        const ids = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
        await send({ action: 'migrate', ids });
        const { response } = await send({ action: 'dismiss', id: 'new' });
        expect(response.status).toBe(409);
        expect((await send(undefined, 'GET')).body.data.dismissedHealthItemIds).toEqual(ids);
    });

    it('reports storage failures instead of claiming a successful save', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        kv.put = async () => {
            throw new Error('storage unavailable');
        };
        expect((await send({ action: 'dismiss', id: 'auto-token' })).response.status).toBe(500);
        expect(kv.data.size).toBe(0);
    });

    it('rejects unsupported methods and unconfigured persistent storage', async () => {
        expect((await send(undefined, 'DELETE')).response.status).toBe(405);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const response = await handleDashboardPreferencesRequest(
            request({ action: 'dismiss', id: 'auto-token' }),
            {}
        );
        expect(response.status).toBe(503);
    });

    it('stores the same preferences through the D1 adapter', async () => {
        const values = new Map([['main', JSON.stringify({ storageType: 'd1' })]]);
        const db = {
            prepare(sql) {
                return {
                    bind(key, value) {
                        return {
                            first: async () => (values.has(key) ? { data: values.get(key) } : null),
                            run: async () => {
                                if (sql.includes('INTO settings')) values.set(key, value);
                                return { success: true };
                            },
                        };
                    },
                };
            },
        };
        const env = { MISUB_DB: db };
        const saved = await handleDashboardPreferencesRequest(
            request({ action: 'dismiss', id: 'auto-token' }),
            env
        );
        expect(saved.status).toBe(200);
        SettingsCache.clear();
        const loaded = await handleDashboardPreferencesRequest(request(undefined, 'GET'), env);
        expect((await loaded.json()).data.dismissedHealthItemIds).toEqual(['auto-token']);
        expect(JSON.parse(values.get(DASHBOARD_PREFERENCES_KEY))).toEqual({
            dismissedHealthItemIds: ['auto-token'],
        });
    });
});
