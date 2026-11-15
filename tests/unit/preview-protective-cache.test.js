// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';
import {
    handleSubscriptionNodesRequest,
    handlePublicPreviewRequest,
} from '../../functions/modules/subscription/preview-handler.js';
import {
    buildSubscriptionNodeCacheKey,
    buildSubscriptionFilterFingerprint,
    generateCombinedNodeList,
} from '../../functions/services/subscription-service.js';

const { createAdapter } = vi.hoisted(() => ({ createAdapter: vi.fn() }));
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter,
        getStorageType: async () => 'd1',
    },
}));
vi.mock('../../functions/services/fetch-utils.js', async () => {
    const actual = await vi.importActual('../../functions/services/fetch-utils.js');
    return {
        ...actual,
        fetchWithRetry: (url, options) => actual.fetchWithRetry(url, options, { baseDelay: 0 }),
    };
});

const SOURCE = {
    id: 'source-a',
    name: 'Source A',
    url: 'https://source.example/sub',
    enabled: true,
    enableNodeCache: true,
};
const NODE = 'trojan://synthetic@cached.example:443#Cached%20Node';
const UPDATED = '2026-11-14T12:00:00.000Z';
let storage;
let store;

function cache(sub = SOURCE, overrides = {}) {
    return {
        nodes: [NODE],
        nodeCount: 1,
        upstreamNodeCount: 1,
        updatedAt: UPDATED,
        sourceUrl: sub.url,
        sourceId: sub.id,
        filterFingerprint: buildSubscriptionFilterFingerprint(sub),
        ...overrides,
    };
}
function fetchNodes(sub = SOURCE, forceRefresh = false) {
    return fetchSubscriptionNodes(
        sub.url,
        sub.name,
        'ClashMeta',
        sub.customUserAgent,
        false,
        sub.exclude,
        sub.fetchProxy,
        false,
        Boolean(sub.plusAsSpace),
        sub.enableNodeCache,
        forceRefresh,
        storage,
        sub
    );
}
function request(data) {
    return new Request('https://misub.example/api/subscription_nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
}
async function preview(data, publicMode = false) {
    const response = await (
        publicMode ? handlePublicPreviewRequest : handleSubscriptionNodesRequest
    )(request(data), {});
    expect(response.status).toBe(200);
    return response.json();
}
beforeEach(() => {
    store = new Map([
        [buildSubscriptionNodeCacheKey(SOURCE), cache()],
        ['worker_settings_v1', {}],
    ]);
    storage = {
        get: vi.fn(async (key) => store.get(key) ?? null),
        put: vi.fn(async (key, value) => {
            store.set(key, value);
        }),
        getSubscriptionById: vi.fn(async () => SOURCE),
        getSubscriptionsByIds: vi.fn(async () => [SOURCE]),
        getProfileById: vi.fn(async () => ({
            id: 'profile-a',
            enabled: true,
            isPublic: true,
            subscriptions: [SOURCE.id],
            manualNodes: [],
        })),
    };
    createAdapter.mockReturnValue(storage);
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('saved-source preview protective cache', () => {
    it.each([
        'snell://secret@edge.example:443?version=3#Snell',
        'naive+https://user:pass@edge.example:443#Naive',
    ])('preserves existing preview protocol support for %s', async (url) => {
        fetch.mockImplementation(async () => new Response(url));
        const result = await fetchNodes();
        expect(result.success).toBe(true);
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].server).toBe('edge.example');
        expect(result.fromCache).toBeUndefined();
    });
    it.each(['http', 'network', 'expired', 'empty', 'pseudo'])(
        'falls back on %s upstream failures and keeps cache provenance',
        async (failure) => {
            if (failure === 'network') fetch.mockRejectedValue(new Error('Network timeout'));
            if (failure === 'expired')
                fetch.mockImplementation(
                    async () => new Response('<html>Subscription expired</html>')
                );
            if (failure === 'empty') fetch.mockImplementation(async () => new Response(''));
            if (failure === 'pseudo')
                fetch.mockImplementation(
                    async () => new Response('trojan://test@127.0.0.1:443#Expired')
                );
            const result = await fetchNodes();
            expect(result).toMatchObject({
                success: true,
                fromCache: true,
                cacheUpdatedAt: UPDATED,
                url: SOURCE.url,
            });
            expect(result.nodes[0]).toMatchObject({
                name: 'Cached Node',
                server: 'cached.example',
                protocol: 'trojan',
                url: NODE,
            });
            expect(result.error).toMatch(
                failure === 'http'
                    ? /HTTP 403/
                    : failure === 'network'
                      ? /Network timeout/
                      : /No valid proxy nodes/
            );
            expect(storage.put).not.toHaveBeenCalled();
        }
    );

    it.each(['http', 'expired', 'network'])(
        'refuses a cache with changed filters on %s failures',
        async (failure) => {
            if (failure === 'expired')
                fetch.mockImplementation(async () => new Response('Expired'));
            if (failure === 'network') fetch.mockRejectedValue(new Error('Network timeout'));
            const result = await fetchNodes({ ...SOURCE, exclude: 'keep:^New-' });
            expect(result.success).toBe(false);
            expect(result.nodes).toEqual([]);
            expect(result.fromCache).toBeUndefined();
        }
    );

    it.each(['operators', 'legacy'])('refuses a cache with changed %s transforms', async (mode) => {
        const operators = [
            { type: 'filter', params: { include: { enabled: true, rules: ['New'] } } },
        ];
        const sub = {
            ...SOURCE,
            ...(mode === 'operators'
                ? { operators: JSON.stringify(operators) }
                : { nodeTransform: { enabled: true, operators } }),
        };
        expect((await fetchNodes(sub)).success).toBe(false);
    });

    it('reads equivalent D1 JSON and array operator fingerprints without executing them twice', async () => {
        const operators = [
            {
                type: 'rename',
                params: {
                    regex: { enabled: true, rules: [{ pattern: '^', replacement: 'Renamed-' }] },
                },
            },
        ];
        const sub = { ...SOURCE, operators };
        const renamed = NODE.replace('Cached%20Node', 'Renamed-Cached%20Node');
        store.set(buildSubscriptionNodeCacheKey(sub), cache(sub, { nodes: [renamed] }));
        const result = await fetchNodes({ ...sub, operators: JSON.stringify(operators) });
        expect(result.fromCache).toBe(true);
        expect(result.nodes[0].name).toBe('Renamed-Cached Node');
    });

    it('does not reapply name filters to URLs already renamed in the cache', async () => {
        const sub = { ...SOURCE, exclude: 'keep:^Original-' };
        store.set(buildSubscriptionNodeCacheKey(sub), cache(sub));
        expect((await fetchNodes(sub)).nodes[0].name).toBe('Cached Node');
    });

    it.each(['keep:^Missing-', '^Live-'])(
        'accepts fresh results intentionally filtered to zero (%s)',
        async (exclude) => {
            const sub = { ...SOURCE, exclude };
            store.set(buildSubscriptionNodeCacheKey(sub), cache(sub));
            fetch.mockImplementation(
                async () => new Response('trojan://test@live.example:443#Live-Node')
            );
            const result = await fetchNodes(sub);
            expect(result).toMatchObject({ success: true, nodes: [], error: null });
            expect(result.fromCache).toBeUndefined();
            expect(storage.put).not.toHaveBeenCalled();
        }
    );

    it('keeps healthy 100-to-1 filtering distinct from a genuine truncated response', async () => {
        const sub = { ...SOURCE, exclude: 'keep:^KEEP-', nodeCount: 1, lastGoodNodeCount: 100 };
        const upstream = Array.from(
            { length: 100 },
            (_, i) => `trojan://test@node${i}.example:443#${i === 0 ? 'KEEP' : 'DROP'}-${i}`
        );
        store.set(buildSubscriptionNodeCacheKey(sub), cache(sub, { upstreamNodeCount: 100 }));
        fetch.mockImplementation(async () => new Response(upstream.join('\n')));
        const healthy = await fetchNodes(sub);
        expect(healthy.nodes).toHaveLength(1);
        expect(healthy.fromCache).toBeUndefined();
        fetch.mockImplementation(async () => new Response(upstream[0]));
        const truncated = await fetchNodes(sub);
        expect(truncated.fromCache).toBe(true);
        expect(truncated.error).toContain('100 -> 1');
    });

    it('retains an intentionally empty output cache instead of reviving older nodes', async () => {
        store.set(
            buildSubscriptionNodeCacheKey(SOURCE),
            cache(SOURCE, { nodes: [], nodeCount: 0, upstreamNodeCount: 100 })
        );
        expect(await fetchNodes()).toMatchObject({
            success: true,
            nodes: [],
            fromCache: true,
            cacheUpdatedAt: UPDATED,
        });
    });

    it('keeps supporting legacy caches without fingerprint/source metadata', async () => {
        store.set(buildSubscriptionNodeCacheKey(SOURCE), { nodes: [NODE], updatedAt: UPDATED });
        expect((await fetchNodes()).fromCache).toBe(true);
    });

    it.each(['disabled', 'miss', 'corrupt', 'read-error', 'wrong-url'])(
        'reports failure when the cache is %s',
        async (mode) => {
            if (mode === 'miss') store.clear();
            if (mode === 'corrupt')
                store.set(buildSubscriptionNodeCacheKey(SOURCE), {
                    nodes: ['Expired'],
                    filterFingerprint: 'anything',
                });
            if (mode === 'read-error')
                storage.get.mockRejectedValue(new Error('Storage unavailable'));
            if (mode === 'wrong-url')
                store.set(
                    buildSubscriptionNodeCacheKey(SOURCE),
                    cache(SOURCE, { sourceUrl: 'https://another.example/sub' })
                );
            const result = await fetchNodes(
                mode === 'disabled' ? { ...SOURCE, enableNodeCache: false } : SOURCE
            );
            expect(result).toMatchObject({
                success: false,
                nodes: [],
                error: 'HTTP 403: Forbidden',
            });
        }
    );

    it.each(['http', 'expired'])(
        'never substitutes cache for a failed force refresh (%s)',
        async (failure) => {
            if (failure === 'expired')
                fetch.mockImplementation(async () => new Response('Expired'));
            const result = await fetchNodes(SOURCE, true);
            expect(result.success).toBe(false);
            expect(result.fromCache).toBeUndefined();
            expect(storage.get).not.toHaveBeenCalled();
            const [url, options] = fetch.mock.calls[0];
            expect(new URL(url).searchParams.has('_t')).toBe(true);
            expect(options.headers['Cache-Control']).toBe('no-cache');
        }
    );

    it('shares the cache and source-URL guard with formal output', async () => {
        const output = await generateCombinedNodeList(
            { storage },
            { enableFlagEmoji: false, enableAccessLog: false },
            'ClashMeta',
            [SOURCE],
            '',
            { enableSubscriptions: false }
        );
        const result = await fetchNodes();
        expect(output.trim()).toBe(result.nodes[0].url);
        const changed = { ...SOURCE, url: 'https://changed.example/sub' };
        const wrongOutput = await generateCombinedNodeList(
            { storage },
            { enableFlagEmoji: false, enableAccessLog: false },
            'ClashMeta',
            [changed],
            '',
            { enableSubscriptions: false }
        );
        expect(wrongOutput.trim()).toBe('');
    });
});

describe('preview endpoint modes', () => {
    it.each(['subscription', 'profile', 'public'])(
        'exposes cached nodes and their errors in %s previews',
        async (mode) => {
            const result = await preview(
                mode === 'subscription'
                    ? { subscriptionId: SOURCE.id }
                    : { profileId: 'profile-a' },
                mode === 'public'
            );
            expect(result.success).toBe(true);
            expect(result.fromCache).toBe(true);
            expect(result.nodes[0].url).toBe(NODE);
            expect(result.stats.protocols).toEqual({ trojan: { count: 1, percentage: 100 } });
            expect(result.subscriptions[0]).toMatchObject({
                fromCache: true,
                error: 'HTTP 403: Forbidden',
                cacheUpdatedAt: UPDATED,
            });
        }
    );

    it('can use the same cache through the KV adapter read path', async () => {
        delete storage.getSubscriptionById;
        store.set('misub_subscriptions_v1', [SOURCE]);
        expect((await preview({ subscriptionId: SOURCE.id })).fromCache).toBe(true);
    });

    it('does not look up saved-source caches for direct URL previews', async () => {
        const result = await preview({ url: SOURCE.url });
        expect(result).toMatchObject({ success: false, nodes: [] });
        expect(storage.get).not.toHaveBeenCalled();
    });

    it('reports HTTP-200 expired direct URLs as failures', async () => {
        fetch.mockImplementation(async () => new Response('Subscription expired'));
        const result = await preview({ url: SOURCE.url });
        expect(result.success).toBe(false);
        expect(result.error).toContain('No valid proxy nodes');
    });

    it('combines fresh, cached, failed, and manual sources while preserving profile transforms', async () => {
        const fresh = { ...SOURCE, id: 'fresh', name: 'Fresh', url: 'https://fresh.example/sub' };
        const failed = {
            ...SOURCE,
            id: 'failed',
            name: 'Failed',
            url: 'https://failed.example/sub',
        };
        const manual = {
            id: 'manual',
            name: 'Manual',
            url: 'trojan://test@manual.example:443#Manual',
            enabled: true,
        };
        storage.getSubscriptionsByIds.mockResolvedValue([SOURCE, fresh, failed, manual]);
        storage.getProfileById.mockResolvedValue({
            id: 'profile-a',
            enabled: true,
            isPublic: true,
            subscriptions: [SOURCE.id, fresh.id, failed.id],
            manualNodes: [manual.id],
            operators: [
                {
                    type: 'rename',
                    params: {
                        regex: {
                            enabled: true,
                            rules: [{ pattern: '^', replacement: 'Profile-' }],
                        },
                    },
                },
            ],
        });
        fetch.mockImplementation(
            async (url) =>
                new Response(
                    new URL(url).hostname === 'fresh.example'
                        ? 'trojan://test@fresh.example:443#Fresh'
                        : 'Forbidden',
                    { status: new URL(url).hostname === 'fresh.example' ? 200 : 403 }
                )
        );
        const result = await preview({ profileId: 'profile-a' });
        expect(result.success).toBe(true);
        expect(result.nodes.map((node) => node.name)).toEqual([
            'Profile-Cached Node',
            'Profile-Fresh',
            'Profile-Manual',
        ]);
        expect(result.subscriptions.filter((sub) => sub.fromCache)).toHaveLength(1);
        expect(result.subscriptions.filter((sub) => !sub.success)).toHaveLength(1);
        expect(result.subscriptions.find((sub) => sub.isManualNode).nodes[0].name).toBe('Manual');
        expect(storage.put).not.toHaveBeenCalled();
    });

    it.each(['subscription', 'profile', 'public'])(
        'reports a force-refresh failure in %s mode despite a valid cache',
        async (mode) => {
            const result = await preview(
                {
                    ...(mode === 'subscription'
                        ? { subscriptionId: SOURCE.id }
                        : { profileId: 'profile-a' }),
                    forceRefresh: true,
                },
                mode === 'public'
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP 403');
            expect(result.fromCache).toBeUndefined();
        }
    );
});
