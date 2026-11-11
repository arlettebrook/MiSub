import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    handleSubscriptionNodesRequest,
    handlePublicPreviewRequest,
} from '../../functions/modules/subscription/preview-handler.js';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';

const storage = vi.hoisted(() => ({
    getProfileById: vi.fn(),
    getSubscriptionById: vi.fn(),
    getSubscriptionsByIds: vi.fn(),
    get: vi.fn(),
}));

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: () => storage,
        getStorageType: async () => 'd1',
    },
}));

const source = {
    id: 'source-1',
    name: 'Example Subscription',
    url: 'https://source.example/sub?token=example&target=clash',
    enabled: true,
    customUserAgent: 'ExampleClient/1.0',
    fetchProxy: 'https://proxy.example/api?url=',
};

const node = 'trojan://password@example.com:443#Fresh%20Node';

function previewRequest(data) {
    return new Request('https://misub.example/api/subscription_nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
}

describe('node preview refresh requests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storage.getProfileById.mockResolvedValue({
            id: 'profile-1',
            enabled: true,
            isPublic: true,
            subscriptions: [source.id],
            manualNodes: [],
        });
        storage.getSubscriptionById.mockResolvedValue(source);
        storage.getSubscriptionsByIds.mockResolvedValue([source]);
        storage.get.mockResolvedValue({ defaultOperators: [] });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(node))
        );
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([{ subscriptionId: source.id }, { profileId: 'profile-1' }, { url: source.url }])(
        'bypasses upstream caches and returns fresh nodes: %j',
        async (mode) => {
            const response = await handleSubscriptionNodesRequest(
                previewRequest({ ...mode, forceRefresh: true }),
                {}
            );
            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.nodes[0].name).toBe('Fresh Node');

            const [fetchUrl, options] = globalThis.fetch.mock.calls[0];
            const requestUrl = new URL(fetchUrl);
            const upstreamUrl = new URL(requestUrl.searchParams.get('url') || requestUrl);
            expect(upstreamUrl.searchParams.get('_t')).toMatch(/^\d+$/);
            expect(upstreamUrl.searchParams.get('token')).toBe('example');
            expect(upstreamUrl.searchParams.get('target')).toBe('clash');
            expect(options.headers['Cache-Control']).toBe('no-cache');
            if (!mode.url) {
                expect(requestUrl.hostname).toBe('proxy.example');
                expect(requestUrl.searchParams.get('ua')).toBe(source.customUserAgent);
                expect(options.headers['User-Agent']).toBe(source.customUserAgent);
            }
        }
    );

    it('supports force refresh for public profile previews', async () => {
        const response = await handlePublicPreviewRequest(
            previewRequest({ profileId: 'profile-1', forceRefresh: true }),
            {}
        );
        expect((await response.json()).nodes[0].name).toBe('Fresh Node');
        const upstream = new URL(
            new URL(globalThis.fetch.mock.calls[0][0]).searchParams.get('url')
        );
        expect(upstream.searchParams.has('_t')).toBe(true);
    });

    it('leaves the upstream URL unchanged for ordinary preview requests', async () => {
        await handleSubscriptionNodesRequest(previewRequest({ subscriptionId: source.id }), {});
        const [fetchUrl, options] = globalThis.fetch.mock.calls[0];
        expect(new URL(fetchUrl).searchParams.get('url')).toBe(source.url);
        expect(options.headers['Cache-Control']).toBeUndefined();
    });

    it.each([{ subscriptionId: source.id }, { profileId: 'profile-1' }, { url: source.url }])(
        'reports upstream failures instead of presenting an empty success: %j',
        async (mode) => {
            globalThis.fetch.mockResolvedValue(
                new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
            );
            const response = await handleSubscriptionNodesRequest(
                previewRequest({ ...mode, forceRefresh: true }),
                {}
            );
            const data = await response.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('HTTP 403');
        }
    );

    it('refreshes the actual upstream URL when a fetch proxy and protective cache are enabled', async () => {
        const result = await fetchSubscriptionNodes(
            source.url,
            source.name,
            source.customUserAgent,
            null,
            false,
            '',
            source.fetchProxy,
            false,
            false,
            true
        );
        expect(result.success).toBe(true);
        const upstream = new URL(
            new URL(globalThis.fetch.mock.calls[0][0]).searchParams.get('url')
        );
        expect(upstream.searchParams.has('_t')).toBe(true);
        expect(upstream.searchParams.get('token')).toBe('example');
    });

    it('returns successful nodes and identifies failed sources in a partial refresh', async () => {
        storage.getProfileById.mockResolvedValue({
            id: 'profile-1',
            enabled: true,
            subscriptions: ['source-1', 'source-2'],
            manualNodes: [],
        });
        storage.getSubscriptionsByIds.mockResolvedValue([
            source,
            { ...source, id: 'source-2', name: 'Second Source' },
        ]);
        globalThis.fetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
        const response = await handleSubscriptionNodesRequest(
            previewRequest({ profileId: 'profile-1', forceRefresh: true }),
            {}
        );
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.nodes[0].name).toBe('Fresh Node');
        expect(data.subscriptions.filter((result) => !result.success)).toHaveLength(1);
    });
});
