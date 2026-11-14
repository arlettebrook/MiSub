// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateCombinedNodeList,
  buildSubscriptionNodeCacheKey,
} from '../../functions/services/subscription-service.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';
import { setCache } from '../../functions/services/node-cache-service.js';

const createAdapter = vi.fn();
vi.mock('../../functions/storage-adapter.js', () => ({
  StorageFactory: {
    createAdapter: (...args) => createAdapter(...args),
    getStorageType: async () => 'kv',
    resolveKV: (env) => env?.MISUB_KV || null,
  },
  STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));

const BASE_SUB = {
  id: 'source-a',
  name: 'Source A',
  url: 'https://example.com/sub-a',
  enabled: true,
  enableNodeCache: true,
  nodeCount: 100,
  lastGoodNodeCount: 100,
};
const KEEP_OPERATOR = {
  type: 'filter',
  params: { include: { enabled: true, rules: ['^KEEP-'] } },
};
const UPSTREAM_NODES = Array.from(
  { length: 100 },
  (_, index) =>
    `trojan://test@node${index}.example.com:443#${index === 0 ? 'KEEP' : 'DROP'}-${index}`
);
const UPSTREAM = UPSTREAM_NODES.join('\n');
const CACHE_KEY = buildSubscriptionNodeCacheKey(BASE_SUB);

function createStorage(subs = [BASE_SUB], settings = {}) {
  const store = new Map([
    ['misub_subscriptions_v1', subs.map((sub) => ({ ...sub }))],
    ['misub_profiles_v1', []],
    [
      'worker_settings_v1',
      {
        mytoken: 'filter-test-token',
        enableFlagEmoji: false,
        enableTrafficNode: false,
        enableAccessLog: false,
        defaultPrefixSettings: { enableSubscriptions: false },
        ...settings,
      },
    ],
  ]);
  return {
    store,
    get: vi.fn(async (key) => store.get(key) ?? null),
    put: vi.fn(async (key, value) => {
      store.set(key, value);
      return true;
    }),
    getAllSubscriptions: async () => store.get('misub_subscriptions_v1'),
    getAllProfiles: async () => store.get('misub_profiles_v1'),
    getSubscriptionsByIds: async (ids) =>
      store.get('misub_subscriptions_v1').filter((sub) => ids.includes(sub.id)),
  };
}

async function generate(storage, sub) {
  const pending = [];
  const context = { storage, waitUntil: (promise) => pending.push(promise) };
  const nodes = await generateCombinedNodeList(
    context,
    { enableFlagEmoji: false, enableAccessLog: false },
    'ClashMeta',
    [sub],
    '',
    { enableSubscriptions: false }
  );
  await Promise.all(pending);
  return { nodes: nodes.trim().split('\n').filter(Boolean), context };
}

async function requestNodes(storage, forceRefresh = false) {
  createAdapter.mockReturnValue(storage);
  const pending = [];
  const response = await handleMisubRequest({
    request: new Request(
      `https://misub.example/filter-test-token?target=nodes${forceRefresh ? '&refresh=1' : ''}`,
      { headers: { 'User-Agent': 'ClashMeta' } }
    ),
    env: {},
    waitUntil: (promise) => pending.push(promise),
  });
  await Promise.all(pending);
  return { response, text: await response.text() };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(UPSTREAM))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('source filters and shrink protection', () => {
  it.each([
    ['include text', { exclude: 'keep:^KEEP-' }],
    ['exclude text', { exclude: '^DROP-' }],
    ['operator', { operators: [KEEP_OPERATOR] }],
    ['JSON operators', { operators: JSON.stringify([KEEP_OPERATOR]) }],
    ['legacy operators', { nodeTransform: { enabled: true, operators: [KEEP_OPERATOR] } }],
  ])('%s keeps one valid node with and without protective caching', async (_name, filter) => {
    for (const enableNodeCache of [false, true]) {
      const sub = { ...BASE_SUB, ...filter, enableNodeCache };
      const storage = createStorage([sub]);
      const result = await generate(storage, sub);
      expect(result.nodes).toEqual([UPSTREAM_NODES[0]]);
      expect(result.context.currentSubscriptionRuntimeInfo[sub.id].nodeCount).toBe(1);
      expect(result.context.currentSubscriptionRuntimeInfo[sub.id].lastGoodNodeCount).toBe(100);
    }
  });

  it('accepts a new filter and replaces the previously unfiltered cache', async () => {
    const storage = createStorage();
    await generate(storage, BASE_SUB);
    const oldFingerprint = storage.store.get(CACHE_KEY).filterFingerprint;
    const sub = { ...BASE_SUB, exclude: 'keep:^KEEP-' };
    expect((await generate(storage, sub)).nodes).toEqual([UPSTREAM_NODES[0]]);
    const cached = storage.store.get(CACHE_KEY);
    expect(cached.nodes).toEqual([UPSTREAM_NODES[0]]);
    expect(cached.upstreamNodeCount).toBe(100);
    expect(typeof cached.filterFingerprint).toBe('string');
    expect(cached.filterFingerprint).not.toBe(oldFingerprint);
  });

  it('accepts reductions when unchanged filters match fewer nodes in a healthy response', async () => {
    const sub = { ...BASE_SUB, exclude: 'keep:^KEEP-' };
    const storage = createStorage([sub]);
    await generate(storage, sub);
    globalThis.fetch.mockResolvedValue(new Response(UPSTREAM.replace('KEEP-0', 'DROP-0')));
    const result = await generate(storage, sub);
    expect(result.nodes).toEqual([]);
    expect(result.context.generationStats.upstreamSuccessCount).toBe(1);
    expect(result.context.generationStats.failCount).toBe(0);
    expect(result.context.currentSubscriptionRuntimeInfo[sub.id].nodeCount).toBe(0);
    expect(storage.store.get(CACHE_KEY).nodes).toEqual([]);
  });

  it('does not revive old nodes after a changed filter yields zero nodes and the next fetch fails', async () => {
    const storage = createStorage();
    await generate(storage, BASE_SUB);
    const sub = { ...BASE_SUB, exclude: 'keep:^MISSING-' };
    expect((await generate(storage, sub)).nodes).toEqual([]);
    const acceptedEmpty = { ...storage.store.get(CACHE_KEY) };
    expect(acceptedEmpty.nodes).toEqual([]);
    globalThis.fetch.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await generate(storage, sub)).nodes).toEqual([]);
    expect(storage.store.get(CACHE_KEY)).toEqual(acceptedEmpty);
  });

  it('does not use a cache transformed by a different filter during an outage', async () => {
    const storage = createStorage();
    await generate(storage, BASE_SUB);
    globalThis.fetch.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await generate(storage, { ...BASE_SUB, exclude: 'keep:^KEEP-' })).nodes).toEqual([]);
  });

  it('keeps the protective cache when the actual upstream response is truncated', async () => {
    const storage = createStorage();
    await generate(storage, BASE_SUB);
    const cached = { ...storage.store.get(CACHE_KEY) };
    globalThis.fetch.mockResolvedValue(new Response(UPSTREAM_NODES[1]));
    expect((await generate(storage, BASE_SUB)).nodes).toEqual(UPSTREAM_NODES);
    expect(storage.store.get(CACHE_KEY)).toEqual(cached);
  });

  it('uses raw cached counts to protect a filtered cache even without stored historical counts', async () => {
    const sub = { ...BASE_SUB, nodeCount: 0, lastGoodNodeCount: 0, exclude: 'keep:^KEEP-' };
    const storage = createStorage([sub]);
    await generate(storage, sub);
    const cached = { ...storage.store.get(CACHE_KEY) };
    globalThis.fetch.mockResolvedValue(new Response(UPSTREAM_NODES[1]));
    expect((await generate(storage, sub)).nodes).toEqual([UPSTREAM_NODES[0]]);
    expect(storage.store.get(CACHE_KEY)).toEqual(cached);
  });

  it('falls back after a 200 expiration page and normalizes equivalent operator representations', async () => {
    const sub = { ...BASE_SUB, operators: [KEEP_OPERATOR] };
    const storage = createStorage([sub]);
    await generate(storage, sub);
    const cached = { ...storage.store.get(CACHE_KEY) };
    globalThis.fetch.mockResolvedValue(new Response('Subscription expired'));
    expect(
      (await generate(storage, { ...sub, operators: JSON.stringify(sub.operators) })).nodes
    ).toEqual([UPSTREAM_NODES[0]]);
    expect(storage.store.get(CACHE_KEY)).toEqual(cached);
  });

  it('migrates a legacy cache after a healthy filtered fetch', async () => {
    const storage = createStorage();
    storage.store.set(CACHE_KEY, { nodes: UPSTREAM_NODES, nodeCount: 100, updatedAt: 'legacy' });
    expect((await generate(storage, { ...BASE_SUB, exclude: 'keep:^KEEP-' })).nodes).toEqual([
      UPSTREAM_NODES[0],
    ]);
    expect(typeof storage.store.get(CACHE_KEY).filterFingerprint).toBe('string');
  });
});

describe('aggregate cache with filtered output', () => {
  it('stores intentional empty output and does not restore an earlier aggregate during an outage', async () => {
    const storage = createStorage();
    await requestNodes(storage, true);
    const subs = storage.store.get('misub_subscriptions_v1');
    subs[0] = { ...subs[0], exclude: 'keep:^MISSING-' };
    const empty = await requestNodes(storage, true);
    expect(empty.text).not.toContain('trojan://test@');
    const acceptedCache = { ...storage.store.get('node_cache_token_filter-test-token') };
    expect(acceptedCache.nodes).toBe('');
    globalThis.fetch.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await requestNodes(storage)).text).not.toContain('trojan://test@');
    expect(storage.store.get('node_cache_token_filter-test-token')).toEqual(acceptedCache);
  });

  it('accepts a verified one-node filter result with traffic and UUID-name markers', async () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const sub = {
      ...BASE_SUB,
      exclude: `keep:^${uuid}`,
      userInfo: { upload: 0, download: 0, total: 100, expire: 4102444800 },
    };
    const storage = createStorage([sub], { enableTrafficNode: true });
    globalThis.fetch.mockResolvedValue(new Response(UPSTREAM.replace('KEEP-0', uuid)));
    const first = await requestNodes(storage, true);
    expect(first.text.trim().split('\n')).toHaveLength(3);
    expect(first.text).toContain(`#${uuid}`);
    expect((await requestNodes(storage)).text).toBe(first.text);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves an aggregate when filtering succeeds for one source but another source fails', async () => {
    const storage = createStorage([
      { ...BASE_SUB, exclude: 'keep:^KEEP-', enableNodeCache: false },
      { ...BASE_SUB, id: 'source-b', url: 'https://example.com/sub-b', enableNodeCache: false },
    ]);
    let failed = false;
    globalThis.fetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/sub-b')) {
        return failed
          ? new Response('Forbidden', { status: 403 })
          : new Response(UPSTREAM.replaceAll('@node', '@other'));
      }
      return new Response(UPSTREAM);
    });
    const first = await requestNodes(storage, true);
    expect(first.text.trim().split('\n')).toHaveLength(101);
    const cached = { ...storage.store.get('node_cache_token_filter-test-token') };
    failed = true;
    expect((await requestNodes(storage, true)).text).toBe(first.text);
    expect(storage.store.get('node_cache_token_filter-test-token')).toEqual(cached);
  });

  it('returns the correct filtered output even if the new aggregate cannot be persisted', async () => {
    const storage = createStorage();
    await requestNodes(storage, true);
    const subs = storage.store.get('misub_subscriptions_v1');
    subs[0] = { ...subs[0], exclude: 'keep:^KEEP-' };
    storage.put.mockImplementation(async (key, value) => {
      if (key === 'node_cache_token_filter-test-token') throw new Error('storage unavailable');
      storage.store.set(key, value);
      return true;
    });
    expect((await requestNodes(storage, true)).text.trim()).toBe(UPSTREAM_NODES[0]);
  });

  it.each([false, true])(
    'accepts a changed filter and reuses the one-node cache (forced=%s)',
    async (force) => {
      const storage = createStorage();
      expect((await requestNodes(storage, true)).text.trim().split('\n')).toHaveLength(100);
      const subs = storage.store.get('misub_subscriptions_v1');
      subs[0] = { ...subs[0], exclude: 'keep:^KEEP-' };
      const filtered = await requestNodes(storage, force);
      expect(filtered.response.status).toBe(200);
      expect(filtered.text.trim()).toBe(UPSTREAM_NODES[0]);
      const cached = await requestNodes(storage);
      expect(cached.text.trim()).toBe(UPSTREAM_NODES[0]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    }
  );

  it('accepts global include filtering and does not restore the previous aggregate', async () => {
    const storage = createStorage();
    await requestNodes(storage, true);
    storage.store.get('worker_settings_v1').exclude = 'keep:^KEEP-';
    const filtered = await requestNodes(storage, true);
    expect(filtered.text.trim()).toBe(UPSTREAM_NODES[0]);
    expect((await requestNodes(storage)).text.trim()).toBe(UPSTREAM_NODES[0]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not authorize aggregate shrink protection bypass for a truly truncated raw response', async () => {
    const existing = { nodes: UPSTREAM + '\n', nodeCount: 100, timestamp: 123 };
    const storage = createStorage();
    storage.store.set('aggregate', existing);
    const saved = await setCache(storage, 'aggregate', '', [], {
      filteredNodeReduction: true,
      upstreamNodeCount: 1,
      filterFingerprint: 'test',
    });
    expect(saved).toBe(false);
    expect(storage.store.get('aggregate')).toEqual(existing);
  });
});
