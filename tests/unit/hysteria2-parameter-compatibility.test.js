// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl as backendExport } from '../../functions/utils/clash-to-url.js';
import { convertClashProxyToUrl as frontendExport } from '../../src/utils/protocols/clash.js';
import { singboxOutboundToUrl } from '../../functions/modules/utils/singbox-to-url.js';
import { extractValidNodes, parseNodeList } from '../../functions/modules/utils/node-parser.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { generateBuiltinSingboxConfig } from '../../functions/modules/subscription/builtin-singbox-generator.js';
import { generateBuiltinSurgeConfig } from '../../functions/modules/subscription/builtin-surge-generator.js';
import { generateBuiltinLoonConfig } from '../../functions/modules/subscription/builtin-loon-generator.js';
import {
    renderClashFromIniTemplate,
    renderSingboxFromIniTemplate,
    renderSurgeFromIniTemplate,
    renderLoonFromIniTemplate,
    renderEgernFromIniTemplate,
} from '../../functions/modules/subscription/template-pipeline.js';
import { parseLoonConfig } from '../../src/utils/protocols/loon-parser.js';
import { parseSurgeConfig } from '../../src/utils/protocols/surge-parser.js';
import {
    normalizeHysteria2HopInterval,
    normalizeHysteria2Ports,
} from '../../src/utils/protocols/common/hysteria2-params.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';

const { createAdapter } = vi.hoisted(() => ({ createAdapter: vi.fn() }));
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter,
        getStorageType: async () => 'kv',
        resolveKV: (env) => env?.MISUB_KV || null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));
const PIN = 'ab'.repeat(32);
const PASSWORD = 'user:password+%#&=中文';
const OBFS = 'obfs+%#&=中文';
const TEMPLATE = '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select';
const BASE = {
    type: 'hysteria2',
    name: 'HY2',
    server: '2001:db8::1',
    port: 443,
    password: PASSWORD,
    sni: 'tls.example',
    fingerprint: PIN,
    ports: '20000-20010,21000',
    'hop-interval': '15',
    'skip-cert-verify': false,
    alpn: ['h3'],
    obfs: 'salamander',
    'obfs-password': OBFS,
    up: '100 Mbps',
    down: '200 Mbps',
};
function link(params = {}, scheme = 'hy2', authority = '[2001:db8::1]:443') {
    return `${scheme}://${encodeURIComponent(PASSWORD)}@${authority}/?${new URLSearchParams(params)}#HY2`;
}
function singboxOutput(url, template = false) {
    return JSON.parse(
        template
            ? renderSingboxFromIniTemplate(TEMPLATE, { nodeList: url })
            : generateBuiltinSingboxConfig(url)
    ).outbounds.find((outbound) => outbound.type === 'hysteria2');
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('HY2 URI aliases and typed hopping', () => {
    it.each(['hysteria2', 'hy2', 'HYSTERIA2', 'HY2'])('recognizes scheme %s', (scheme) => {
        expect(urlToClashProxy(link({ peer: 'tls.example' }, scheme))).toMatchObject({
            type: 'hysteria2',
            server: '2001:db8::1',
            port: 443,
            sni: 'tls.example',
            password: PASSWORD,
        });
    });
    it.each(['pinSHA256', 'hpkp', 'fingerprint'])(
        'maps %s to the certificate fingerprint',
        (key) => {
            const proxy = urlToClashProxy(
                link({ [key]: PIN, peer: 'peer.example', 'hop-interval': '30s' })
            );
            expect(proxy).toMatchObject({
                fingerprint: PIN,
                sni: 'peer.example',
                servername: 'peer.example',
                'hop-interval': '30',
            });
        }
    );
    it('gives sni and pinSHA256 precedence over alternate spellings', () => {
        expect(
            urlToClashProxy(
                link({
                    sni: 'primary.example',
                    peer: 'fallback.example',
                    pinSHA256: PIN,
                    hpkp: 'ignore',
                    fingerprint: 'ignore',
                })
            )
        ).toMatchObject({ sni: 'primary.example', fingerprint: PIN });
    });
    it.each(['ports', 'mport'])(
        'keeps %s ranges and a separately configured primary port',
        (key) => {
            expect(urlToClashProxy(link({ [key]: '20000-20010,21000' }))).toMatchObject({
                ports: '20000-20010,21000',
                port: 443,
            });
        }
    );
    it.each([
        '[2001:db8::1]:20000-20010,21000',
        'edge.example:20000-20010,21000',
        '203.0.113.1:20000-20010,21000',
    ])('accepts native multi-port authorities (%s)', (authority) => {
        expect(urlToClashProxy(link({}, 'hy2', authority))).toMatchObject({
            port: 20000,
            ports: '20000-20010,21000',
        });
    });
    it.each([
        ['15', '15'],
        [15, '15'],
        ['30s', '30'],
        ['1m', '60'],
        ['1m30s', '90'],
        ['10-20', '10-20'],
        ['10s-20s', '10-20'],
        [0, '0'],
    ])('normalizes interval %s to %s', (input, expected) => {
        expect(normalizeHysteria2HopInterval(input)).toBe(expected);
        expect(urlToClashProxy(link({ hopInterval: input }))['hop-interval']).toBe(expected);
    });
    it.each(['wrong', '-1', '30-10', '1.5s', true, Infinity])(
        'ignores invalid interval %j',
        (value) => {
            expect(normalizeHysteria2HopInterval(value)).toBeUndefined();
        }
    );
    it.each(['0', '70000', '30-10', '20000,,21000', 'bad'])('ignores invalid ports %s', (value) => {
        expect(normalizeHysteria2Ports(value)).toBeUndefined();
        expect(urlToClashProxy(link({ ports: value }))).not.toHaveProperty('ports');
    });
    it('normalizes sing-box colon ranges and port arrays to Mihomo ranges', () => {
        expect(normalizeHysteria2Ports(['20000:20010', '21000'])).toBe('20000-20010,21000');
        expect(normalizeHysteria2Ports('20000-20010,21000', ':')).toBe('20000:20010,21000');
    });
    it('keeps legacy bandwidth aliases, ALPN and explicitly disabled certificate skipping', () => {
        expect(
            urlToClashProxy(link({ upmbps: '100', downmbps: '200', insecure: '0', alpn: 'h3, h2' }))
        ).toMatchObject({
            up: '100 Mbps',
            down: '200 Mbps',
            alpn: ['h3', 'h2'],
            'skip-cert-verify': false,
        });
        expect(
            urlToClashProxy(
                link({ up: '20 Mbps', upmbps: '100', down: '30 Mbps', downmbps: '200' })
            )
        ).toMatchObject({ up: '20 Mbps', down: '30 Mbps' });
    });
});

describe.each([
    ['frontend', frontendExport],
    ['backend', backendExport],
])('%s HY2 export', (_label, convert) => {
    it.each(['hysteria2', 'hy2'])('retains all compatible parameters for proxy type %s', (type) => {
        const original = structuredClone({ ...BASE, type });
        const url = convert(original);
        const parsedUrl = new URL(url);
        expect(parsedUrl.hostname).toBe('[2001:db8::1]');
        expect(parsedUrl.port).toBe('443');
        expect(parsedUrl.searchParams.get('pinSHA256')).toBe(PIN);
        expect(parsedUrl.searchParams.get('ports')).toBe(BASE.ports);
        expect(parsedUrl.searchParams.get('hop-interval')).toBe('15');
        expect(urlToClashProxy(url)).toMatchObject({ ...BASE, type: 'hysteria2' });
        expect(original).toEqual({ ...BASE, type });
    });
    it('never interprets a ClientHello fingerprint as a certificate pin', () => {
        const url = convert({ ...BASE, fingerprint: undefined, 'client-fingerprint': 'chrome' });
        expect(new URL(url).searchParams.has('pinSHA256')).toBe(false);
        expect(urlToClashProxy(url)).not.toHaveProperty('fingerprint');
        const explicit = new URL(convert({ ...BASE, 'client-fingerprint': 'chrome' }));
        expect(explicit.searchParams.get('pinSHA256')).toBe(PIN);
    });
    it('retains old Hysteria1 behavior without changing its protocol', () => {
        const proxy = {
            ...BASE,
            type: 'hysteria',
            ports: undefined,
            fingerprint: undefined,
            up: '100',
            down: '200',
        };
        expect(convert(proxy)).toMatch(/^hysteria:\/\//);
    });
});

describe('HY2 output compatibility', () => {
    it.each([false, true])(
        'preserves certificate pins and hopping in Clash output (template=%s)',
        (template) => {
            const url = backendExport(BASE);
            const config = yaml.load(
                template
                    ? renderClashFromIniTemplate(TEMPLATE, { nodeList: url })
                    : generateBuiltinClashConfig(url)
            );
            expect(config.proxies[0]).toMatchObject({
                fingerprint: PIN,
                ports: BASE.ports,
                'hop-interval': '15',
                sni: BASE.sni,
            });
        }
    );
    it.each([false, true])(
        'maps pin-free HY2 hopping, ALPN and bandwidth to valid sing-box fields (template=%s)',
        (template) => {
            const url = backendExport({ ...BASE, fingerprint: undefined, 'hop-interval': '10-20' });
            expect(singboxOutput(url, template)).toMatchObject({
                server: BASE.server,
                server_port: 443,
                server_ports: ['20000:20010', '21000:21000'],
                hop_interval: '10s',
                hop_interval_max: '20s',
                up_mbps: 100,
                down_mbps: 200,
                password: PASSWORD,
                obfs: { type: 'salamander', password: OBFS },
                tls: { enabled: true, server_name: BASE.sni, alpn: ['h3'] },
            });
        }
    );
    it.each(['0', '2', '15'])('matches Mihomo interval defaults and minimum for %s', (interval) => {
        const expected = interval === '0' ? '30s' : interval === '2' ? '5s' : '15s';
        expect(
            singboxOutput(
                backendExport({ ...BASE, fingerprint: undefined, 'hop-interval': interval })
            ).hop_interval
        ).toBe(expected);
    });
    it.each([false, true])(
        'refuses to mislabel a certificate pin as a public-key hash in sing-box (template=%s)',
        (template) => {
            expect(() => singboxOutput(backendExport(BASE), template)).toThrow(
                /certificate hashes and public-key hashes are different/
            );
        }
    );
    it.each([false, true])(
        'writes Surge port lists, scalar interval and certificate pin (template=%s)',
        (template) => {
            const url = backendExport(BASE);
            const output = template
                ? renderSurgeFromIniTemplate(TEMPLATE, { nodeList: url })
                : generateBuiltinSurgeConfig(url);
            expect(output).toContain('port-hopping=20000-20010;21000');
            expect(output).toContain('port-hopping-interval=15');
            expect(output).toContain('download-bandwidth=200');
            expect(output).not.toContain('download-bandwidth=200 Mbps');
            expect(output).toContain(`server-cert-fingerprint-sha256=${PIN}`);
            const [parsed] = parseSurgeConfig(output);
            expect(urlToClashProxy(parsed.url)).toMatchObject({
                fingerprint: PIN,
                ports: BASE.ports,
                'hop-interval': '15',
                sni: BASE.sni,
                password: PASSWORD,
            });
        }
    );
    it.each([false, true])(
        'writes pin-free Loon port lists and intervals (template=%s)',
        (template) => {
            const url = backendExport({ ...BASE, fingerprint: undefined });
            const output = template
                ? renderLoonFromIniTemplate(TEMPLATE, { nodeList: url })
                : generateBuiltinLoonConfig(url);
            expect(output).toContain('server-ports="20000-20010,21000"');
            expect(output).toContain('hop-interval=15');
            expect(output).toContain('download-bandwidth=200');
            const [parsed] = parseLoonConfig(output);
            expect(urlToClashProxy(parsed.url)).toMatchObject({
                ports: BASE.ports,
                'hop-interval': '15',
                sni: BASE.sni,
                password: PASSWORD,
            });
        }
    );
    it.each(['Surge', 'Loon'])(
        'reports unsupported hop ranges for %s instead of emitting invalid fields',
        (target) => {
            const url = backendExport({ ...BASE, fingerprint: undefined, 'hop-interval': '10-20' });
            expect(() =>
                (target === 'Surge' ? generateBuiltinSurgeConfig : generateBuiltinLoonConfig)(url)
            ).toThrow(/single hop interval/);
        }
    );
    it.each(['Loon', 'Egern'])(
        'explicitly rejects a pinned export without verified support in %s',
        (target) => {
            expect(() =>
                (target === 'Loon' ? renderLoonFromIniTemplate : renderEgernFromIniTemplate)(
                    TEMPLATE,
                    { nodeList: backendExport(BASE) }
                )
            ).toThrow(/no verified equivalent/);
        }
    );
    it('retains parameters through Clash YAML import, parsing and regeneration', () => {
        const original = yaml.dump({ proxies: [BASE] });
        const [url] = extractValidNodes(original);
        expect(urlToClashProxy(url)).toMatchObject(BASE);
        expect(parseNodeList(url)[0]).toMatchObject({ server: BASE.server, port: '443' });
    });
});

describe('sing-box HY2 import', () => {
    it('retains server ports, hopping range, ALPN, SNI, bandwidth and passwords through URI', () => {
        const input = {
            type: 'hysteria2',
            server: BASE.server,
            server_port: 443,
            server_ports: ['20000:20010', '21000:21000'],
            hop_interval: '10s',
            hop_interval_max: '20s',
            password: PASSWORD,
            up_mbps: 100,
            down_mbps: 200,
            obfs: { type: 'salamander', password: OBFS },
            tls: { enabled: true, server_name: BASE.sni, alpn: ['h3'], insecure: false },
        };
        const url = singboxOutboundToUrl(input);
        expect(urlToClashProxy(url)).toMatchObject({
            ports: BASE.ports,
            'hop-interval': '10-20',
            up: '100',
            down: '200',
            sni: BASE.sni,
            alpn: ['h3'],
            password: PASSWORD,
        });
        for (const template of [false, true])
            expect(singboxOutput(url, template)).toMatchObject({
                server_ports: input.server_ports,
                hop_interval: '10s',
                hop_interval_max: '20s',
            });
    });
    it('imports a hopping outbound that only declares server_ports', () => {
        const url = singboxOutboundToUrl({
            type: 'hysteria2',
            server: 'edge.example',
            server_ports: ['20000:20010'],
            password: 'test',
        });
        expect(urlToClashProxy(url)).toMatchObject({ port: 20000, ports: '20000-20010' });
    });
});

describe('INI and subscription request integration', () => {
    it.each([
        `HY2 = hysteria2, edge.example, 443, password=test, peer=tls.example, server-cert-fingerprint-sha256=${PIN}, port-hopping=20000-20010;21000, port-hopping-interval=15`,
        `HY2 = hysteria2, edge.example, 443, test, server-ports="20000-20010,21000", hop-interval=15, sni=tls.example`,
        `hysteria2=edge.example:443, password=test, fingerprint=${PIN}, mport="20000-20010,21000", hop-interval=15, sni=tls.example, tag=HY2`,
    ])('preserves HY2 fields in backend INI imports: %s', (input) => {
        const [url] = extractValidNodes(input);
        expect(urlToClashProxy(url)).toMatchObject({
            sni: 'tls.example',
            ports: BASE.ports,
            'hop-interval': '15',
        });
        if (input.includes(PIN)) expect(urlToClashProxy(url).fingerprint).toBe(PIN);
    });
    it.each(['builtin', 'template'])(
        'returns HTTP 422 for unsupported certificate pins in a sing-box subscription (%s)',
        async (mode) => {
            const values = new Map([
                [
                    'worker_settings_v1',
                    {
                        mytoken: 'hy2-test',
                        builtinEngine: true,
                        engineMode: 'builtin',
                        enableFlagEmoji: false,
                        enableAccessLog: false,
                        defaultPrefixSettings: { enableSubscriptions: false },
                    },
                ],
                [
                    'misub_subscriptions_v1',
                    [{ id: 'hy2-node', enabled: true, url: backendExport(BASE) }],
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
            const result = await handleMisubRequest({
                request: new Request(
                    `https://misub.example/hy2-test?target=singbox${mode === 'template' ? '&template=clash_misub_minimal' : ''}`,
                    { headers: { 'User-Agent': 'sing-box' } }
                ),
                env: {},
                waitUntil: () => {},
            });
            expect(result.status).toBe(422);
            expect((await result.json()).error).toContain(
                'certificate hashes and public-key hashes are different'
            );
        }
    );
});
