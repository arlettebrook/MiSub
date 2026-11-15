// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import {
    parseHttpProxyEndpoint,
    markHttpProxyUrl,
    isHttpProxyUrl,
    isManualNodeSource,
    isRemoteSubscriptionSource,
} from '../../shared/node-source.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl as backend } from '../../functions/utils/clash-to-url.js';
import { convertClashProxyToUrl as frontend } from '../../src/utils/protocols/clash.js';
import { singboxOutboundToUrl } from '../../functions/modules/utils/singbox-to-url.js';
import { extractValidNodes, parseNodeList } from '../../functions/modules/utils/node-parser.js';
import {
    isRealProxyNode,
    generateCombinedNodeList,
    buildSubscriptionNodeCacheKey,
    buildSubscriptionFilterFingerprint,
} from '../../functions/services/subscription-service.js';
import { handleSingleSubscriptionMode } from '../../functions/modules/subscription/single-subscription.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';
import {
    handleNodeCountRequest,
    handleBatchUpdateNodesRequest,
} from '../../functions/modules/handlers/node-handler.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { generateBuiltinSingboxConfig } from '../../functions/modules/subscription/builtin-singbox-generator.js';
import { generateBuiltinSurgeConfig } from '../../functions/modules/subscription/builtin-surge-generator.js';
import { generateBuiltinLoonConfig } from '../../functions/modules/subscription/builtin-loon-generator.js';
import {
    renderClashFromIniTemplate,
    renderSingboxFromIniTemplate,
    renderSurgeFromIniTemplate,
    renderLoonFromIniTemplate,
} from '../../functions/modules/subscription/template-pipeline.js';
import { parseSurgeConfig } from '../../src/utils/protocols/surge-parser.js';
import { parseLoonConfig } from '../../src/utils/protocols/loon-parser.js';
import { parseQuantumultXConfig } from '../../src/utils/protocols/quantumultx-parser.js';
import { generateBuiltinQuanxConfig } from '../../functions/modules/subscription/builtin-quanx-generator.js';
import { renderQuanxFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import {
    isManualNode,
    isRemoteSubscription,
} from '../../functions/modules/external-api-mappers.js';
import { handleExternalManualNodesRequest } from '../../functions/modules/external-manual-nodes-handler.js';

const { createAdapter } = vi.hoisted(() => ({ createAdapter: vi.fn() }));
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter,
        getStorageType: async () => 'kv',
        resolveKV: (env) => env?.MISUB_KV || null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));
const TEMPLATE = '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select';
const BASE = {
    name: 'HTTP Node',
    type: 'http',
    server: '2001:db8::1',
    port: 8080,
    username: 'user+%中文',
    password: 'p@ss:word+%#&=中文',
};
let storage, store;
beforeEach(() => {
    store = new Map([
        [
            'worker_settings_v1',
            {
                mytoken: 'http-test',
                engineMode: 'builtin',
                builtinEngine: true,
                enableFlagEmoji: false,
                enableAccessLog: false,
                defaultPrefixSettings: { enableSubscriptions: false },
            },
        ],
        ['misub_subscriptions_v1', []],
        ['misub_profiles_v1', []],
    ]);
    storage = {
        get: vi.fn(async (key) => store.get(key) ?? null),
        put: vi.fn(async (key, value) => store.set(key, value)),
        getAllSubscriptions: async () => store.get('misub_subscriptions_v1'),
        getAllProfiles: async () => store.get('misub_profiles_v1'),
        getSubscriptionById: async (id) =>
            store.get('misub_subscriptions_v1').find((sub) => sub.id === id),
        getProfileById: async (id) =>
            store.get('misub_profiles_v1').find((profile) => profile.id === id),
        getSubscriptionsByIds: async (ids) =>
            store.get('misub_subscriptions_v1').filter((sub) => ids.includes(sub.id)),
        putSubscription: async (sub) => store.get('misub_subscriptions_v1').push(sub),
    };
    createAdapter.mockReturnValue(storage);
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
            throw new Error('Proxy must not be fetched as a subscription');
        })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('HTTP proxy and subscription boundaries', () => {
    it.each([
        'http://user:pass@edge.example:8080#Node',
        'https://edge.example:443#Node',
        'http://edge.example:8080?proxy=1',
        'HTTPS://[2001:db8::1]:443/?sni=tls.example#Node',
    ])('identifies explicit proxy %s throughout source classifiers', (url) => {
        expect(isHttpProxyUrl(url)).toBe(true);
        expect(isManualNodeSource({ url })).toBe(true);
        expect(isManualNode({ url })).toBe(true);
        expect(isRemoteSubscription({ url })).toBe(false);
        expect(isRealProxyNode(url)).toBe(true);
    });
    it.each([
        'https://sub.example:8443/sub?token=test#name',
        'https://sub.example:8443/',
        'http://sub.example:8080',
        'https://user:pass@sub.example:8443/sub',
        'https://sub.example:8443/?token=test',
        'https://sub.example/sub#Node',
        'https://sub.example/?target=clash',
        'https://sub.example/',
    ])('preserves ordinary subscription %s', (url) => {
        expect(isRemoteSubscriptionSource(url)).toBe(true);
        expect(isManualNodeSource(url)).toBe(false);
        expect(isRealProxyNode(url)).toBe(false);
    });
    it.each([
        'http://edge.example:80',
        'https://edge.example:443',
        'https://[2001:db8::1]:443',
        'https://edge.example',
    ])('marks an explicit proxy import without losing default ports (%s)', (url) => {
        const marked = markHttpProxyUrl(url);
        expect(marked).toContain('proxy=1');
        expect(isManualNodeSource(marked)).toBe(true);
        expect(markHttpProxyUrl(marked)).toBe(marked);
        expect(urlToClashProxy(marked).port).toBe(url.toLowerCase().startsWith('https') ? 443 : 80);
    });
    it.each([
        'http://edge.example:0',
        'https://edge.example:70000',
        'http://edge.example/path',
        'https://edge.example/?token=foo',
        'https://',
    ])('rejects invalid or remote URLs as proxy endpoints (%s)', (url) => {
        expect(parseHttpProxyEndpoint(url)).toBeNull();
        expect(urlToClashProxy(url)).toBeNull();
    });
    it.each(['http://127.0.0.1:8080#Node', 'https://[::1]:443#Node'])(
        'retains local-endpoint filtering for %s',
        (url) => {
            expect(isRealProxyNode(url)).toBe(false);
        }
    );
});

describe.each([
    ['frontend', frontend],
    ['backend', backend],
])('%s HTTP conversion', (_name, convert) => {
    it.each([{ type: 'http', tls: false }, { type: 'http', tls: true }, { type: 'https' }])(
        'preserves TLS, auth and IPv6 for %j',
        (variant) => {
            const proxy = {
                ...BASE,
                ...variant,
                sni: 'tls.example',
                alpn: ['h2', 'http/1.1'],
                'skip-cert-verify': false,
                'client-fingerprint': 'chrome',
                headers: { 'X-Valid': 'value+%&=中文' },
                'dialer-proxy': 'chain',
            };
            const original = structuredClone(proxy);
            const url = convert(proxy);
            const secure = variant.type === 'https' || variant.tls === true;
            expect(new URL(url).protocol).toBe(secure ? 'https:' : 'http:');
            const parsed = urlToClashProxy(url);
            expect(parsed).toMatchObject({
                type: 'http',
                server: BASE.server,
                port: BASE.port,
                username: BASE.username,
                password: BASE.password,
                headers: proxy.headers,
                'dialer-proxy': 'chain',
            });
            if (secure)
                expect(parsed).toMatchObject({
                    tls: true,
                    sni: 'tls.example',
                    alpn: proxy.alpn,
                    'skip-cert-verify': false,
                    'client-fingerprint': 'chrome',
                });
            else expect(parsed.tls).toBeUndefined();
            expect(proxy).toEqual(original);
        }
    );
    it.each([
        { username: '', password: '' },
        { username: 'user', password: '' },
        { username: '', password: 'secret' },
    ])('supports anonymous and partial credentials %j', (auth) => {
        const url = convert({ ...BASE, ...auth });
        expect(urlToClashProxy(url)).toMatchObject(auth);
        expect(isManualNodeSource(url)).toBe(true);
    });
    it('creates an identifiable name for an unnamed anonymous proxy', () => {
        const url = convert({ ...BASE, name: undefined, username: undefined, password: undefined });
        expect(isManualNodeSource(url)).toBe(true);
    });
});

describe('HTTP node import and client output', () => {
    it.each([false, true])(
        'keeps Quantumult X HTTP TLS and credentials through both import paths (TLS=%s)',
        (tls) => {
            const url = backend({ ...BASE, tls, sni: 'tls.example' });
            for (const text of [
                generateBuiltinQuanxConfig(url),
                renderQuanxFromIniTemplate(TEMPLATE, { nodeList: url }),
            ]) {
                const parsed = parseQuantumultXConfig(text);
                expect(parsed).toHaveLength(1);
                expect(urlToClashProxy(parsed[0].url)).toMatchObject({
                    username: BASE.username,
                    password: BASE.password,
                    ...(tls ? { tls: true } : {}),
                });
                const lines = extractValidNodes(text);
                expect(lines).toHaveLength(1);
                expect(urlToClashProxy(lines[0])).toMatchObject({
                    username: BASE.username,
                    password: BASE.password,
                    ...(tls ? { tls: true } : {}),
                });
            }
        }
    );
    it.each([false, true])(
        'preserves proxy configuration through YAML and sing-box imports (TLS=%s)',
        (tls) => {
            const proxy = { ...BASE, tls, sni: 'tls.example', 'skip-cert-verify': false };
            const [url] = extractValidNodes(yaml.dump({ proxies: [proxy] }));
            expect(urlToClashProxy(url)).toMatchObject({
                ...BASE,
                ...(tls ? { tls: true, sni: 'tls.example' } : {}),
            });
            const imported = singboxOutboundToUrl({
                type: 'http',
                server: BASE.server,
                server_port: BASE.port,
                tag: BASE.name,
                username: BASE.username,
                password: BASE.password,
                tls: { enabled: tls, server_name: 'tls.example', alpn: ['h2'], insecure: false },
            });
            expect(urlToClashProxy(imported)).toMatchObject({
                type: 'http',
                server: BASE.server,
                username: BASE.username,
                password: BASE.password,
                ...(tls ? { tls: true, alpn: ['h2'] } : {}),
            });
        }
    );
    it('parses root HTTP nodes in node-list context while excluding subscription URLs', () => {
        const nodes = parseNodeList(
            'http://edge.example:8080\nhttps://edge.example:443\nhttps://sub.example/sub?token=test'
        );
        expect(nodes).toHaveLength(2);
        expect(nodes.map((node) => isManualNodeSource(node.url))).toEqual([true, true]);
    });
    it.each([false, true])(
        'preserves HTTPS TLS in built-in and template output (TLS=%s)',
        (tls) => {
            const url = backend({
                ...BASE,
                tls,
                sni: 'tls.example',
                alpn: ['h2', 'http/1.1'],
                'skip-cert-verify': false,
            });
            for (const text of [
                generateBuiltinClashConfig(url),
                renderClashFromIniTemplate(TEMPLATE, { nodeList: url }),
            ]) {
                const proxy = yaml.load(text).proxies[0];
                expect(proxy.type).toBe('http');
                expect(Boolean(proxy.tls)).toBe(tls);
            }
            for (const text of [
                generateBuiltinSingboxConfig(url),
                renderSingboxFromIniTemplate(TEMPLATE, { nodeList: url }),
            ]) {
                const proxy = JSON.parse(text).outbounds.find((node) => node.type === 'http');
                expect(proxy).toMatchObject({
                    server: BASE.server,
                    server_port: BASE.port,
                    username: BASE.username,
                    password: BASE.password,
                });
                expect(Boolean(proxy.tls?.enabled)).toBe(tls);
                if (tls)
                    expect(proxy.tls).toMatchObject({
                        server_name: 'tls.example',
                        insecure: false,
                        alpn: ['h2', 'http/1.1'],
                    });
            }
        }
    );
    it.each([false, true])(
        'round trips HTTP/HTTPS auth through Surge and Loon output (TLS=%s)',
        (tls) => {
            const input = { ...BASE, tls, sni: 'tls.example' };
            const url = backend(input);
            for (const output of [
                generateBuiltinSurgeConfig(url),
                renderSurgeFromIniTemplate(TEMPLATE, { nodeList: url }),
            ]) {
                const nodes = parseSurgeConfig(output);
                expect(nodes).toHaveLength(1);
                expect(urlToClashProxy(nodes[0].url)).toMatchObject({
                    username: BASE.username,
                    password: BASE.password,
                    ...(tls ? { tls: true } : {}),
                });
            }
            for (const output of [
                generateBuiltinLoonConfig(url),
                renderLoonFromIniTemplate(TEMPLATE, { nodeList: url }),
            ]) {
                const nodes = parseLoonConfig(output);
                expect(nodes).toHaveLength(1);
                expect(urlToClashProxy(nodes[0].url)).toMatchObject({
                    username: BASE.username,
                    password: BASE.password,
                    ...(tls ? { tls: true } : {}),
                });
            }
        }
    );
});

describe('HTTP nodes in preview, output and refresh', () => {
    const node = () => ({ id: 'http-node', name: 'HTTP Node', enabled: true, url: backend(BASE) });
    it('renders HTTP manual nodes in single and profile previews without fetching them', async () => {
        store.set('misub_subscriptions_v1', [node()]);
        store.set('misub_profiles_v1', [
            {
                id: 'profile',
                name: 'HTTP Profile',
                enabled: true,
                subscriptions: [],
                manualNodes: ['http-node'],
            },
        ]);
        const request = new Request('https://misub.example/api/subscription_nodes');
        const single = await handleSingleSubscriptionMode(request, {}, 'http-node', 'test');
        const profile = await handleProfileMode(request, {}, 'profile', 'test');
        for (const result of [single, profile]) {
            expect(result.success).toBe(true);
            expect(result.nodes).toHaveLength(1);
            expect(result.subscriptions[0].isManualNode).toBe(true);
        }
        expect(fetch).not.toHaveBeenCalled();
    });
    it('includes older HTTP nodes referenced in a subscriptions list without fetching the endpoint', async () => {
        store.set('misub_subscriptions_v1', [node()]);
        store.set('misub_profiles_v1', [
            { id: 'profile', enabled: true, subscriptions: [{ id: 'http-node' }], manualNodes: [] },
        ]);
        const result = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'profile',
            'test'
        );
        expect(result.nodes).toHaveLength(1);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('fetches only the real subscription in a mixed source list', async () => {
        const remote = {
            id: 'remote',
            name: 'Remote',
            enabled: true,
            url: 'https://sub.example:8443/sub?token=test',
        };
        fetch.mockImplementation(async () => new Response('trojan://test@live.example:443#Remote'));
        const text = await generateCombinedNodeList(
            { storage },
            { enableFlagEmoji: false, enableAccessLog: false },
            'ClashMeta',
            [node(), remote],
            '',
            { enableSubscriptions: false }
        );
        expect(text).toContain('http://');
        expect(text).toContain('trojan://');
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0].url || fetch.mock.calls[0][0]).toContain(
            'sub.example:8443/sub'
        );
    });
    it('protects HTTP nodes as real nodes in a per-source cache', async () => {
        const remote = {
            id: 'remote',
            enabled: true,
            url: 'https://sub.example/sub',
            enableNodeCache: true,
        };
        fetch.mockResolvedValue(new Response(backend(BASE)));
        const text = await generateCombinedNodeList(
            { storage },
            { enableFlagEmoji: false, enableAccessLog: false },
            'ClashMeta',
            [remote],
            '',
            { enableSubscriptions: false }
        );
        expect(text).toContain('http://');
        const cached = store.get(buildSubscriptionNodeCacheKey(remote));
        expect(cached.nodes).toHaveLength(1);
        expect(cached.filterFingerprint).toBe(buildSubscriptionFilterFingerprint(remote));
    });
    it('returns valid HTTP nodes on fresh and cached formal profile requests', async () => {
        store.set('misub_subscriptions_v1', [node()]);
        store.set('misub_profiles_v1', [
            {
                id: 'profile',
                name: 'HTTP Profile',
                enabled: true,
                subscriptions: [],
                manualNodes: ['http-node'],
            },
        ]);
        for (let i = 0; i < 2; i++) {
            const response = await handleMisubRequest({
                request: new Request(
                    'https://misub.example/profiles/profile?target=clash&builtin=true',
                    {
                        headers: { 'User-Agent': 'ClashMeta' },
                    }
                ),
                env: {},
                waitUntil: () => {},
            });
            expect(response.status).toBe(200);
            const content = await response.text();
            expect(content).toContain('proxies:');
            expect(yaml.load(content).proxies[0]).toMatchObject({
                type: 'http',
                username: BASE.username,
            });
        }
        expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects explicit proxies from subscription refresh endpoints', async () => {
        const response = await handleNodeCountRequest(
            new Request('https://misub.example/api/node_count', {
                method: 'POST',
                body: JSON.stringify({ url: node().url }),
            }),
            {}
        );
        expect(response.status).toBe(400);
        store.set('misub_subscriptions_v1', [node()]);
        const batch = await handleBatchUpdateNodesRequest(
            new Request('https://misub.example/api/batch_update_nodes', {
                method: 'POST',
                body: JSON.stringify({ subscriptionIds: ['http-node'] }),
            }),
            {}
        );
        expect(batch.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('accepts an anonymous root proxy in the explicit external manual-node workflow', async () => {
        const response = await handleExternalManualNodesRequest(
            new Request('https://misub.example/api/external/manual-nodes', {
                method: 'POST',
                body: JSON.stringify({ name: 'Anonymous', url: 'http://edge.example:80' }),
            }),
            {}
        );
        expect(response.status).toBe(201);
        const stored = store.get('misub_subscriptions_v1')[0];
        expect(isManualNode(stored)).toBe(true);
        expect(isRemoteSubscription(stored)).toBe(false);
        expect(stored.url).toContain(':80');
    });
});
