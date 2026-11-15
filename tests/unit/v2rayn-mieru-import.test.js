// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { parseV2rayNLink } from '../../functions/modules/utils/v2rayn-parser.js';
import { parseMieruLinks, convertMieruToUrl } from '../../src/utils/protocols/common/mieru.js';
import { parseNodeList, extractValidNodes } from '../../functions/modules/utils/node-parser.js';
import { urlToClashProxy, urlsToClashProxies } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl as backend } from '../../functions/utils/clash-to-url.js';
import { convertClashProxyToUrl as frontend } from '../../src/utils/protocols/clash.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { transformBuiltinSubscription } from '../../functions/modules/subscription/transformer-factory.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';
import {
    generateCombinedNodeList,
    isRealProxyNode,
    buildSubscriptionNodeCacheKey,
} from '../../functions/services/subscription-service.js';
import { handleParseSubscription } from '../../functions/modules/parse-subscription-handler.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';
import { handleSingleSubscriptionMode } from '../../functions/modules/subscription/single-subscription.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { isManualNodeSource } from '../../shared/node-source.js';
const { createAdapter } = vi.hoisted(() => ({ createAdapter: vi.fn() }));
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter,
        getStorageType: async () => 'kv',
        resolveKV: (env) => env?.MISUB_KV || null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));
const UUID = '11111111-1111-4111-8111-111111111111';
const cfg = {
    Address: '2001:db8::1',
    Port: 443,
    Remarks: '配置 #中文',
    Sni: 'tls.example',
    AllowInsecure: false,
};
const wrap = (type, config) =>
    `v2rayn://${type}/${Buffer.from(JSON.stringify(config)).toString('base64url')}`;
const MIERU = {
    name: 'Mieru 节点',
    type: 'mieru',
    server: '2001:db8::2',
    port: 8443,
    username: 'user+%中文',
    password: 'p@ss:word+%#&=中文',
    transport: 'TCP',
    udp: false,
    multiplexing: 'MULTIPLEXING_HIGH',
    'handshake-mode': 'HANDSHAKE_NO_WAIT',
    mtu: 1400,
    profile: 'default',
};
const TEMPLATE = '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select';
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('v2rayN profile links', () => {
    it.each([
        [
            'vmess',
            {
                ConfigType: 1,
                Password: UUID,
                StreamSecurity: 'tls',
                Network: 'ws',
                ProtoExtraObj: { AlterId: '0', VmessSecurity: 'auto' },
                TransportExtraObj: { Path: '/ws', Host: 'host.example' },
            },
            'vmess',
        ],
        [
            'vless',
            {
                ConfigType: 5,
                Password: UUID,
                StreamSecurity: 'reality',
                PublicKey: 'A'.repeat(43),
                ShortId: 'abcd',
                ProtoExtraObj: { Flow: 'xtls-rprx-vision', VlessEncryption: 'none' },
            },
            'vless',
        ],
        [
            'trojan',
            {
                ConfigType: 6,
                Password: 'p@ss+中文',
                StreamSecurity: 'tls',
                Network: 'grpc',
                TransportExtraObj: { GrpcServiceName: 'service', GrpcMode: 'gun' },
            },
            'trojan',
        ],
        [
            'shadowsocks',
            { ConfigType: 3, Password: 'secret', ProtoExtraObj: { SsMethod: 'aes-128-gcm' } },
            'ss',
        ],
        [
            'hysteria2',
            {
                ConfigType: 7,
                Password: 'secret',
                ProtoExtraObj: {
                    UpMbps: 100,
                    DownMbps: 200,
                    SalamanderPass: 'obfs+中文',
                    Ports: '20000-20010',
                    HopInterval: '15',
                },
            },
            'hysteria2',
        ],
        [
            'tuic',
            {
                ConfigType: 8,
                Username: UUID,
                Password: 'secret',
                ProtoExtraObj: { CongestionControl: 'bbr' },
            },
            'tuic',
        ],
        ['anytls', { ConfigType: 11, Password: 'secret', Alpn: 'h2,http/1.1' }, 'anytls'],
        [
            'http',
            { ConfigType: 10, Username: 'user', Password: 'secret', StreamSecurity: 'tls' },
            'http',
        ],
    ])('converts official-style %s profiles into standard nodes', (type, options, expectedType) => {
        const link = wrap(type, { ...cfg, ...options });
        const uri = parseV2rayNLink(link);
        expect(uri).toBeTruthy();
        const proxy = urlToClashProxy(uri);
        expect(proxy).toMatchObject({
            type: expectedType,
            server: cfg.Address,
            port: 443,
            name: cfg.Remarks,
        });
        expect(parseNodeList(link)).toHaveLength(1);
        expect(urlToClashProxy(link)).toEqual(proxy);
        expect(isManualNodeSource(link)).toBe(true);
    });
    it('preserves modern protocol and transport extra fields for VLESS XHTTP', () => {
        const link = wrap('vless', {
            ...cfg,
            Password: UUID,
            StreamSecurity: 'tls',
            Network: 'xhttp',
            PacketEncoding: '',
            ProtoExtraObj: { VlessEncryption: 'custom+encryption/=' },
            TransportExtraObj: {
                Path: '/xhttp',
                Host: 'host.example',
                XhttpMode: 'packet-up',
                XhttpExtra: JSON.stringify({
                    headers: { 'X-Key': 'value' },
                    xmux: { maxConnections: 2 },
                    xPaddingObfsMode: false,
                }),
            },
        });
        const proxy = urlToClashProxy(parseV2rayNLink(link));
        expect(proxy).toMatchObject({
            'packet-encoding': '',
            encryption: 'custom+encryption/=',
            'xhttp-opts': {
                path: '/xhttp',
                host: 'host.example',
                mode: 'packet-up',
                headers: { 'X-Key': 'value', Host: 'host.example' },
                'reuse-settings': { 'max-connections': '2' },
                'x-padding-obfs-mode': false,
            },
        });
    });
    it('accepts older lower-case field names and flattened extra JSON', () => {
        const link = wrap('vless', {
            address: 'edge.example',
            port: 443,
            id: UUID,
            streamSecurity: 'tls',
            protoExtra: JSON.stringify({ Flow: 'xtls-rprx-vision', VlessEncryption: 'none' }),
            transportExtra: JSON.stringify({ Path: '/ws', Host: 'host.example' }),
            network: 'ws',
        });
        expect(urlToClashProxy(parseV2rayNLink(link))).toMatchObject({
            uuid: UUID,
            flow: 'xtls-rprx-vision',
            'ws-opts': { path: '/ws', headers: { Host: 'host.example' } },
        });
    });
    it('uses embedded HY2 certificate fingerprints without weakening certificate validation', () => {
        const link = wrap('hysteria2', {
            ...cfg,
            ConfigType: 7,
            Password: 'secret',
            CertSha: 'ab'.repeat(32),
        });
        expect(urlToClashProxy(parseV2rayNLink(link))).toMatchObject({
            fingerprint: 'ab'.repeat(32),
            'skip-cert-verify': false,
        });
    });
    it.each([
        { Cert: '-----BEGIN CERTIFICATE-----invalid' },
        { EchConfigList: 'ECH' },
        { Finalmask: '{}' },
        { MuxEnabled: true },
        { Network: 'kcp' },
        { StreamSecurity: 'xtls' },
        { ConfigType: 13 },
        { Password: 'bad-id' },
        { Port: 0 },
        { Address: '' },
        { Protocol: 'trojan' },
    ])('rejects unrepresentable or invalid profiles without enabling insecure %j', (invalid) => {
        const link = wrap('vless', { ...cfg, Password: UUID, ...invalid });
        expect(parseV2rayNLink(link)).toBeNull();
        expect(parseNodeList(link)).toEqual([]);
    });
    it.each([
        'v2rayn://vless/bad!',
        'v2rayn://vless/a',
        wrap('unknown', cfg),
        wrap('vless', []),
        'v2rayn://vless/%%%%',
    ])('ignores malformed payloads %s', (input) => {
        expect(parseV2rayNLink(input)).toBeNull();
    });
    it('handles BOM-free base64url, conventional base64, and mixed encoded subscriptions', () => {
        const link = wrap('vless', { ...cfg, Password: UUID });
        const standard = link.replace(
            Buffer.from(JSON.stringify({ ...cfg, Password: UUID })).toString('base64url'),
            Buffer.from(JSON.stringify({ ...cfg, Password: UUID })).toString('base64')
        );
        expect(parseV2rayNLink(standard)).toBe(parseV2rayNLink(link));
        const encoded = Buffer.from(`${link}\ntrojan://secret@edge.example:443#Other`).toString(
            'base64'
        );
        expect(parseNodeList(encoded)).toHaveLength(2);
    });
});

describe('Mieru native sharing and Mihomo conversion', () => {
    it('preserves native MTU metadata but refuses to ignore a custom MTU on Mihomo export', () => {
        const url = convertMieruToUrl({ ...MIERU, mtu: 1280 });
        expect(urlToClashProxy(url).mtu).toBe(1280);
        expect(() => generateBuiltinClashConfig(url, { isMeta: true })).toThrow(
            /cannot preserve a non-default MTU/
        );
    });
    it.each([frontend, backend])(
        'round trips protocol fields and credentials through the official simple URI',
        (convert) => {
            const input = structuredClone(MIERU),
                url = convert(input);
            expect(url).toMatch(/^mierus:\/\//);
            expect(new URL(url).hostname).toBe('[2001:db8::2]');
            expect(new URL(url).searchParams.get('multiplexing')).toBe('MULTIPLEXING_HIGH');
            expect(urlToClashProxy(url)).toEqual(input);
            expect(input).toEqual(MIERU);
            expect(parseNodeInfo(url)).toMatchObject({
                protocol: 'mieru',
                server: input.server,
                port: '8443',
                name: input.name,
            });
        }
    );
    it('expands paired multi-port native links without mixing TCP and UDP', () => {
        const url = `mierus://user:pass@[2001:db8::1]?profile=default&port=443&protocol=TCP&port=1000-1010&protocol=UDP`;
        const nodes = parseNodeList(url);
        expect(nodes).toHaveLength(2);
        const proxies = nodes.map((node) => urlToClashProxy(node.url));
        expect(proxies[0]).toMatchObject({ port: 443, transport: 'TCP' });
        expect(proxies[1]).toMatchObject({ 'port-range': '1000-1010', transport: 'UDP' });
        expect(urlsToClashProxies([url])).toHaveLength(2);
        expect(urlToClashProxy(url)).toBeNull(); // Never silently choose one binding.
    });
    it('supports a Mihomo range-only node without adding a competing primary port', () => {
        const proxy = { ...MIERU, port: undefined, 'port-range': '1000-1010' };
        const url = convertMieruToUrl(proxy);
        const converted = urlToClashProxy(url);
        expect(converted['port-range']).toBe('1000-1010');
        expect(converted).not.toHaveProperty('port');
        expect(
            yaml.load(generateBuiltinClashConfig(url, { isMeta: true })).proxies[0]['port-range']
        ).toBe('1000-1010');
    });
    it('accepts the earlier upstream internal authority URI', () => {
        const url =
            'mierus://edge.example:443?username=user&password=pass&transport=UDP&multiplexing=MULTIPLEXING_LOW&handshake-mode=HANDSHAKE_STANDARD#Legacy';
        expect(urlToClashProxy(url)).toMatchObject({
            username: 'user',
            password: 'pass',
            transport: 'UDP',
            name: 'Legacy',
            port: 443,
        });
    });
    it('reads the official complete protobuf example into independent outbound nodes', () => {
        const link =
            'mieru://CpsBCgdkZWZhdWx0ElgKBWJhb3ppEg1tYW5saWFucGVuZmVuGkA0MGFiYWM0MGY1OWRhNTVkYWQ2YTk5ODMxYTUxMTY1MjJmYmM4MGUzODViYjFhYjE0ZGM1MmRiMzY4ZjczOGE0Gi8SCWxvY2FsaG9zdBoFCIo0EAIaDRACGgk5OTk5LTk5OTkaBQjZMhABGgUIoCYQASD4CioCCAQSB2RlZmF1bHQYnUYguAgwBTgA';
        const proxies = parseMieruLinks(link);
        expect(proxies).toHaveLength(4);
        expect(proxies[0]).toMatchObject({
            server: 'localhost',
            username: 'baozi',
            password: 'manlianpenfen',
            port: 6666,
            transport: 'TCP',
            mtu: 1400,
            multiplexing: 'MULTIPLEXING_HIGH',
        });
        expect(proxies[1]).toMatchObject({ 'port-range': '9999-9999', transport: 'TCP' });
        expect(proxies[2].transport).toBe('UDP');
        expect(parseNodeList(link)).toHaveLength(4);
    });
    it.each([
        { username: '' },
        { password: '' },
        { transport: 'HTTP' },
        { multiplexing: true },
        { multiplexing: 'HIGH' },
        { 'handshake-mode': 'standard' },
        { port: 70000 },
        { mtu: 12 },
    ])('rejects invalid typed Mieru fields %j', (changes) => {
        expect(convertMieruToUrl({ ...MIERU, ...changes })).toBeNull();
    });
    it.each([
        'mierus://user:pass@edge.example?profile=default&port=443&protocol=TCP&port=80',
        'mierus://user:pass@edge.example?profile=default&port=0&protocol=TCP',
        'mieru://invalid!',
        'mieru://CgU=',
        'mierus://edge.example?profile=default&port=443&protocol=TCP',
    ])('rejects malformed native links %s', (url) => {
        expect(parseMieruLinks(url)).toEqual([]);
    });
    it('preserves Mieru YAML through frontend, backend and INI template output', () => {
        const nodes = extractValidNodes(yaml.dump({ proxies: [MIERU] }));
        expect(nodes).toHaveLength(1);
        for (const output of [
            generateBuiltinClashConfig(nodes.join('\n'), { isMeta: true, addFlagEmoji: false }),
            renderClashFromIniTemplate(TEMPLATE, {
                nodeList: nodes.join('\n'),
                isMeta: true,
                addFlagEmoji: false,
            }),
        ]) {
            expect(yaml.load(output).proxies[0]).toMatchObject(MIERU);
        }
        expect(isRealProxyNode(nodes[0])).toBe(true);
    });
    it.each(['singbox', 'surge', 'loon', 'egern', 'quanx', 'clash'])(
        'does not pretend Mieru is supported by target %s without Meta',
        (target) => {
            expect(() => transformBuiltinSubscription(convertMieruToUrl(MIERU), target)).toThrow(
                /requires Mihomo\/Meta/
            );
        }
    );
});

describe('new formats across import, preview and subscriptions', () => {
    it('previews every binding of a saved complete Mieru link without fetching the proxy', async () => {
        const url =
            'mierus://user:pass@edge.example?profile=default&port=443&protocol=TCP&port=1000-1010&protocol=UDP';
        const sub = { id: 'native', enabled: true, url };
        createAdapter.mockReturnValue({
            get: async () => null,
            getSubscriptionById: async () => sub,
            getSubscriptionsByIds: async () => [sub],
            getProfileById: async () => ({ enabled: true, manualNodes: ['native'] }),
        });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const single = await handleSingleSubscriptionMode(
            new Request('https://misub.example/preview'),
            {},
            'native',
            'test'
        );
        const profile = await handleProfileMode(
            new Request('https://misub.example/preview'),
            {},
            'profile',
            'test'
        );
        expect(single.nodes).toHaveLength(2);
        expect(profile.nodes).toHaveLength(2);
        expect(single.nodes.every((node) => node.protocol === 'mieru')).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('returns normalized nodes through the parse API without requests to embedded endpoints', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const content = wrap('vless', { ...cfg, Password: UUID }) + '\n' + convertMieruToUrl(MIERU);
        const response = await handleParseSubscription(
            new Request('https://misub.example/api/parse_subscription', {
                method: 'POST',
                body: JSON.stringify({ content }),
            }),
            {}
        );
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.nodes).toHaveLength(2);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('parses new-format content from a remote subscription and writes protective caches', async () => {
        const values = new Map(),
            storage = {
                get: async (key) => values.get(key) ?? null,
                put: async (key, value) => values.set(key, value),
            };
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        wrap('vless', { ...cfg, Password: UUID }) + '\n' + convertMieruToUrl(MIERU)
                    )
            )
        );
        const sub = { id: 'remote', url: 'https://sub.example/sub', enableNodeCache: true };
        const output = await generateCombinedNodeList(
            { storage },
            { enableAccessLog: false, enableFlagEmoji: false },
            'ClashMeta',
            [sub],
            '',
            { enableSubscriptions: false }
        );
        expect(output).toContain('vless://');
        expect(output).toContain('mierus://');
        expect(values.get(buildSubscriptionNodeCacheKey(sub)).nodes).toHaveLength(2);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('normalizes saved full-profile links and multi-binding Mieru without fetching them', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const output = await generateCombinedNodeList(
            {},
            { enableAccessLog: false, enableFlagEmoji: false },
            'ClashMeta',
            [
                { url: wrap('vless', { ...cfg, Password: UUID }) },
                {
                    url: 'mierus://user:pass@edge.example?profile=default&port=443&protocol=TCP&port=1000-1010&protocol=UDP',
                },
            ],
            '',
            { enableManualNodes: false }
        );
        expect(output.trim().split('\n')).toHaveLength(3);
        expect(output).not.toContain('v2rayn://');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('returns a controlled error when a requested client cannot represent Mieru', async () => {
        const values = new Map([
            ['worker_settings_v1', { mytoken: 'new-format-test', enableAccessLog: false }],
            [
                'misub_subscriptions_v1',
                [{ id: 'node', enabled: true, url: convertMieruToUrl(MIERU) }],
            ],
            ['misub_profiles_v1', []],
        ]);
        createAdapter.mockReturnValue({
            get: async (key) => values.get(key) ?? null,
            put: async (key, value) => values.set(key, value),
            getAllSubscriptions: async () => values.get('misub_subscriptions_v1'),
            getAllProfiles: async () => [],
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const response = await handleMisubRequest({
            request: new Request('https://misub.example/new-format-test?target=singbox', {
                headers: { 'User-Agent': 'sing-box' },
            }),
            env: {},
            waitUntil: () => {},
        });
        expect(response.status).toBe(422);
        expect((await response.json()).error).toContain('Mieru requires Mihomo');
    });
});
