import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { useSessionStore } from '../../src/stores/session.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useToastStore } from '../../src/stores/toast.js';
import { createSessionSync, SESSION_EVENT_KEY } from '../../src/utils/session-sync.js';

const apiMocks = vi.hoisted(() => ({
    fetchInitialData: vi.fn(),
    fetchSessionStatus: vi.fn(),
    fetchPublicConfig: vi.fn(),
    login: vi.fn(),
    get: vi.fn(),
    push: vi.fn(),
    cancelPrivateRequests: vi.fn(),
}));
vi.mock('../../src/lib/api', () => apiMocks);
vi.mock('../../src/lib/http.js', () => ({
    api: { get: apiMocks.get },
    cancelPendingRequests: vi.fn(),
    cancelPrivateRequests: apiMocks.cancelPrivateRequests,
}));
vi.mock('../../src/router', () => ({ default: { push: apiMocks.push } }));
vi.mock('../../src/utils/errorHandler.js', () => ({ handleError: vi.fn() }));

const channels = new Set();
const clients = [];
class FakeChannel {
    constructor(name) {
        this.name = name;
        channels.add(this);
    }
    postMessage(data) {
        for (const peer of channels)
            if (peer !== this && peer.name === this.name) {
                queueMicrotask(() => {
                    if (channels.has(peer)) peer.onmessage?.({ data });
                });
            }
    }
    close() {
        channels.delete(this);
    }
}

function client() {
    const pinia = createPinia();
    const store = useSessionStore(pinia);
    const data = useDataStore(pinia);
    const initial = {
        misubs: [{ id: 'one', name: 'saved', url: 'https://example.com/sub' }],
        profiles: [],
        config: {},
    };
    data.hydrateFromData(initial);
    store.initialData = initial;
    store.sessionState = 'loggedIn';
    store.loginPath = '/admin-login';
    store.startSessionSync();
    clients.push({ pinia, store });
    return { store, data, toast: useToastStore(pinia) };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    apiMocks.get.mockReset().mockResolvedValue({ success: true });
    apiMocks.fetchSessionStatus.mockReset().mockResolvedValue({ success: true });
    apiMocks.fetchPublicConfig.mockReset().mockResolvedValue({
        success: true,
        data: { enablePublicPage: false, hasCustomLoginPath: true },
    });
    apiMocks.fetchInitialData.mockReset();
});

afterEach(() => {
    for (const { store, pinia } of clients.splice(0)) {
        store.stopSessionSync();
        pinia._e.stop();
    }
    channels.clear();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('session synchronization across tabs', () => {
    it('pauses the other tab during logout and clears its private data after confirmation without notifications', async () => {
        const first = client();
        const second = client();
        second.data.updateSubscription('one', { name: 'unsaved draft' });
        let finishLogout;
        apiMocks.get.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishLogout = resolve;
                })
        );
        const logout = first.store.logout();
        await flushPromises();
        expect(second.store.isRemoteLogoutPending).toBe(true);
        expect(second.store.canSendPrivateRequest()).toBe(false);
        expect(second.data.subscriptions[0].name).toBe('unsaved draft');
        const event = JSON.parse(localStorage.getItem(SESSION_EVENT_KEY));
        expect(Object.keys(event).sort()).toEqual(['id', 'sender', 'time', 'type']);
        expect(JSON.stringify(event)).not.toContain('admin-login');
        finishLogout({ success: true });
        await logout;
        await flushPromises();
        expect(second.store.sessionState).toBe('loggedOut');
        expect(second.data.subscriptions).toEqual([]);
        expect(second.store.initialData).toBeNull();
        expect(second.toast.toasts).toHaveLength(0);
        expect(apiMocks.push).toHaveBeenCalledExactlyOnceWith({ path: '/' });
    });

    it('revalidates the other tab and preserves its edits if logout is not confirmed', async () => {
        const first = client();
        const second = client();
        second.data.updateSubscription('one', { name: 'draft' });
        apiMocks.get.mockRejectedValueOnce(new Error('network down'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await first.store.logout()).toBe(false);
        await flushPromises();
        expect(second.store.sessionState).toBe('loggedIn');
        expect(second.data.subscriptions[0].name).toBe('draft');
        expect(second.data.isDirty).toBe(true);
        expect(apiMocks.fetchInitialData).not.toHaveBeenCalled();
        expect(second.toast.toasts).toHaveLength(0);
    });

    it('uses storage events when BroadcastChannel is unavailable', async () => {
        vi.stubGlobal('BroadcastChannel', undefined);
        const first = client();
        const second = client();
        await first.store.logout();
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: SESSION_EVENT_KEY,
                newValue: localStorage.getItem(SESSION_EVENT_KEY),
            })
        );
        expect(second.store.sessionState).toBe('loggedOut');
        expect(second.data.subscriptions).toEqual([]);
    });

    it('rejects a late successful session response after another tab exits', async () => {
        const second = client();
        let finishCheck;
        apiMocks.fetchSessionStatus.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishCheck = resolve;
                })
        );
        const check = second.store.revalidateSession();
        await flushPromises();
        const publisher = createSessionSync(() => {});
        publisher.publish('logout');
        await flushPromises();
        finishCheck({ success: true });
        expect(await check).toBe(false);
        expect(second.store.sessionState).toBe('loggedOut');
        expect(second.data.subscriptions).toEqual([]);
        publisher.close();
    });

    it('verifies the session after a pending logout sender disappears instead of staying locked', async () => {
        vi.useFakeTimers();
        const second = client();
        const publisher = createSessionSync(() => {});
        publisher.publish('logout-start');
        await Promise.resolve();
        publisher.close();
        expect(second.store.isRemoteLogoutPending).toBe(true);
        await vi.advanceTimersByTimeAsync(30000);
        expect(second.store.sessionState).toBe('loggedIn');
        expect(second.store.isRemoteLogoutPending).toBe(false);
    });
});

describe('session verification while disconnected', () => {
    it('bounds automatic retries while the connection remains unavailable', async () => {
        vi.useFakeTimers();
        const { store } = client();
        apiMocks.fetchSessionStatus.mockResolvedValue({ success: false, errorType: 'network' });
        store.reportConnectionIssue();
        await vi.advanceTimersByTimeAsync(120000);
        expect(apiMocks.fetchSessionStatus).toHaveBeenCalledTimes(4);
        expect(store.sessionState).toBe('unverified');
    });

    it('preserves drafts, pauses requests, and reconnects without refreshing business data', async () => {
        const { store, data } = client();
        data.updateSubscription('one', { name: 'draft' });
        store.reportConnectionIssue();
        expect(store.sessionState).toBe('unverified');
        expect(store.canSendPrivateRequest()).toBe(false);
        expect(data.subscriptions[0].name).toBe('draft');
        expect(await store.retrySession()).toBe(true);
        expect(store.sessionState).toBe('loggedIn');
        expect(data.subscriptions[0].name).toBe('draft');
        expect(data.isDirty).toBe(true);
        expect(apiMocks.fetchInitialData).not.toHaveBeenCalled();
    });

    it('keeps an unavailable session unverified and only clears data when auth failure is confirmed', async () => {
        const { store, data } = client();
        apiMocks.fetchSessionStatus.mockResolvedValueOnce({ success: false, errorType: 'network' });
        expect(await store.retrySession()).toBe(false);
        expect(store.sessionState).toBe('unverified');
        expect(data.subscriptions).toHaveLength(1);
        apiMocks.fetchSessionStatus.mockResolvedValueOnce({ success: false, errorType: 'auth' });
        expect(await store.retrySession()).toBe(false);
        expect(store.sessionState).toBe('loggedOut');
        expect(data.subscriptions).toEqual([]);
    });
});
