import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDashboardPreferencesStore } from '../../src/stores/dashboard-preferences.js';
import { useToastStore } from '../../src/stores/toast.js';
import { useSessionStore } from '../../src/stores/session.js';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../src/lib/http.js', () => ({ api, cancelPendingRequests: vi.fn() }));
const CACHE_KEY = 'misub:dismissedHealthItems';
const PENDING_KEY = `${CACHE_KEY}:pending`;
let server;

function newClient(clearCache = false) {
    if (clearCache) localStorage.clear();
    setActivePinia(createPinia());
    useSessionStore().sessionState = 'loggedIn';
    return useDashboardPreferencesStore();
}
function result() {
    return {
        success: true,
        initialized: server != null,
        data: { dismissedHealthItemIds: [...(server || [])] },
    };
}

beforeEach(() => {
    localStorage.clear();
    server = null;
    api.get.mockReset().mockImplementation(async () => result());
    api.post.mockReset().mockImplementation(async (_, body) => {
        let ids = server || [];
        if (body.action === 'migrate' && server == null) ids = body.ids;
        if (body.action === 'dismiss') ids = [...new Set([...ids, body.id])];
        if (body.action === 'restore') ids = ids.filter((id) => id !== body.id);
        if (body.action === 'restore-all') ids = [];
        server = [...ids];
        return result();
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('dashboard preference synchronization', () => {
    it.each(['loading', 'loggedOut'])(
        'does not request private preferences while the session is %s',
        async (state) => {
            const client = newClient();
            useSessionStore().sessionState = state;
            expect(await client.sync()).toBe(false);
            expect(api.get).not.toHaveBeenCalled();
            expect(useToastStore().toasts).toHaveLength(0);
        }
    );

    it('pauses preference synchronization during an intentional logout', async () => {
        const client = newClient();
        useSessionStore().isLoggingOut = true;
        expect(await client.sync()).toBe(false);
        expect(api.get).not.toHaveBeenCalled();
        expect(useToastStore().toasts).toHaveLength(0);
    });

    it('does not report an expired session as a network synchronization failure', async () => {
        const client = newClient();
        api.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
        expect(await client.sync()).toBe(false);
        expect(useToastStore().toasts).toHaveLength(0);
    });

    it('keeps pending actions local when logout completes during a request', async () => {
        const client = newClient();
        let finishGet;
        api.get.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishGet = resolve;
                })
        );
        const dismissal = client.dismiss('subscription-errors:one');
        useSessionStore().sessionState = 'loggedOut';
        finishGet(result());
        expect(await dismissal).toBe(false);
        expect(api.post).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(PENDING_KEY))).toEqual([
            { action: 'dismiss', id: 'subscription-errors:one' },
        ]);
        expect(useToastStore().toasts).toHaveLength(0);
        useSessionStore().sessionState = 'loggedIn';
        expect(await client.sync()).toBe(true);
        expect(server).toEqual(['subscription-errors:one']);
    });

    it('loads ignored issues from the server with an empty browser cache', async () => {
        server = ['subscription-errors:one', 'low-traffic:two'];
        const client = newClient();
        expect(await client.sync()).toBe(true);
        expect(client.dismissedHealthItemIds).toEqual(server);
        expect(JSON.parse(localStorage.getItem(CACHE_KEY))).toEqual(server);
    });

    it('persists single dismissals and restorations across independent clients', async () => {
        const first = newClient();
        await first.dismiss('subscription-errors:one');
        await first.dismiss('low-traffic:two');
        const second = newClient(true);
        await second.sync();
        expect(second.dismissedHealthItemIds).toEqual([
            'subscription-errors:one',
            'low-traffic:two',
        ]);
        await second.restore('subscription-errors:one');
        expect(server).toEqual(['low-traffic:two']);
        await first.sync();
        expect(first.dismissedHealthItemIds).toEqual(['low-traffic:two']);
        await first.restoreAll();
        const third = newClient(true);
        await third.sync();
        expect(third.dismissedHealthItemIds).toEqual([]);
        expect(server).toEqual([]);
    });

    it('migrates legacy browser dismissals only before server preferences exist', async () => {
        localStorage.setItem(CACHE_KEY, JSON.stringify(['auto-token']));
        const client = newClient();
        await client.sync();
        expect(server).toEqual(['auto-token']);
        expect(api.post).toHaveBeenCalledWith(
            '/api/dashboard/preferences',
            { action: 'migrate', ids: ['auto-token'] },
            { background: true }
        );
        await client.restore('auto-token');
        localStorage.clear();
        localStorage.setItem(CACHE_KEY, JSON.stringify(['auto-token']));
        const staleClient = newClient();
        await staleClient.sync();
        expect(staleClient.dismissedHealthItemIds).toEqual([]);
        expect(server).toEqual([]);
    });

    it('keeps rapid actions in order while the initial server load is pending', async () => {
        server = [];
        let finishGet;
        api.get.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishGet = resolve;
                })
        );
        const client = newClient();
        const syncing = client.sync();
        const dismissed = client.dismiss('subscription-errors:one');
        const restored = client.restore('subscription-errors:one');
        const another = client.dismiss('low-traffic:two');
        expect(client.dismissedHealthItemIds).toEqual(['low-traffic:two']);
        finishGet(result());
        await Promise.all([syncing, dismissed, restored, another]);
        expect(api.post.mock.calls.map(([, body]) => body.action)).toEqual([
            'dismiss',
            'restore',
            'dismiss',
        ]);
        expect(client.dismissedHealthItemIds).toEqual(['low-traffic:two']);
        expect(server).toEqual(['low-traffic:two']);
    });

    it('retains failed writes and retries them after a browser reload', async () => {
        server = [];
        const client = newClient();
        await client.sync();
        api.post.mockRejectedValueOnce(new Error('offline'));
        expect(await client.dismiss('subscription-errors:one')).toBe(false);
        expect(client.dismissedHealthItemIds).toEqual(['subscription-errors:one']);
        expect(JSON.parse(localStorage.getItem(PENDING_KEY))).toEqual([
            { action: 'dismiss', id: 'subscription-errors:one' },
        ]);
        expect(useToastStore().toasts).toHaveLength(1);
        const reloaded = newClient();
        expect(await reloaded.sync()).toBe(true);
        expect(server).toEqual(['subscription-errors:one']);
        expect(JSON.parse(localStorage.getItem(PENDING_KEY))).toEqual([]);
    });

    it('retains a pending single restore instead of resurrecting the ignored issue', async () => {
        server = ['subscription-errors:one', 'low-traffic:two'];
        const client = newClient();
        await client.sync();
        api.post.mockRejectedValueOnce(new Error('offline'));
        await client.restore('subscription-errors:one');
        expect(client.dismissedHealthItemIds).toEqual(['low-traffic:two']);
        const reloaded = newClient();
        await reloaded.sync();
        expect(server).toEqual(['low-traffic:two']);
        expect(reloaded.dismissedHealthItemIds).toEqual(['low-traffic:two']);
    });

    it('can save to the server when localStorage is unavailable', async () => {
        vi.stubGlobal('localStorage', {
            getItem() {
                throw new Error('blocked');
            },
            setItem() {
                throw new Error('blocked');
            },
            removeItem() {
                throw new Error('blocked');
            },
        });
        const client = newClient();
        expect(await client.dismiss('auto-token')).toBe(true);
        expect(server).toEqual(['auto-token']);
        expect(client.dismissedHealthItemIds).toEqual(['auto-token']);
    });
});
