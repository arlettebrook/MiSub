// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { convertClashProxyToUrl as backendExport } from '../../functions/utils/clash-to-url.js';
import { convertClashProxyToUrl as frontendExport } from '../../src/utils/protocols/clash.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { singboxOutboundToUrl } from '../../functions/modules/utils/singbox-to-url.js';
import { parseNodeList } from '../../functions/modules/utils/node-parser.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';
import { runOperatorChain } from '../../functions/utils/operator-runner.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const PORT = 8443;
const PROXIES = [
    { type: 'ss', cipher: 'aes-128-gcm', password: 'p@ss:word' },
    {
        type: 'ss',
        cipher: '2022-blake3-aes-256-gcm',
        password: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    },
    { type: 'trojan', password: 'p@ss:word' },
    { type: 'vless', uuid: UUID, tls: true, servername: 'tls.example.com' },
    { type: 'hysteria2', password: 'p@ss:word' },
    { type: 'tuic', uuid: UUID, password: 'p@ss:word' },
    { type: 'anytls', password: 'p@ss:word' },
    { type: 'socks5', username: 'alice', password: 'p@ss:word' },
    {
        type: 'wireguard',
        'private-key': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        'public-key': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        ip: '10.0.0.2/32',
        ipv6: 'fd00::2/128',
    },
];
const HOSTS = [
    '2001:db8::1',
    '[2001:db8::1]',
    '2001:0db8:0:0:0:0:0:1',
    '::ffff:192.0.2.1',
    '203.0.113.9',
    'edge.example.com',
];
const bareHost = (value) => value.replace(/^\[|\]$/g, '');
const canonicalHost = (value) => {
    const bare = bareHost(value);
    return bare.includes(':') ? new URL(`http://[${bare}]/`).hostname : bare;
};

afterEach(() => vi.restoreAllMocks());

describe.each([
    ['backend', backendExport],
    ['frontend', frontendExport],
])('%s URI IPv6 boundaries', (_label, convert) => {
    it.each(
        PROXIES.flatMap((proxy) =>
            HOSTS.map((server) => ({ ...proxy, server, port: PORT, name: 'IPv6 节点' }))
        )
    )('$type preserves $server and its explicit port', (proxy) => {
        const original = structuredClone(proxy);
        const url = convert(proxy);
        expect(typeof url).toBe('string');
        const authority = new URL(url);
        expect(authority.hostname).toBe(canonicalHost(proxy.server));
        expect(authority.port).toBe(String(PORT));
        expect(url).not.toContain('[[');
        const parsed = urlToClashProxy(url);
        expect(canonicalHost(parsed.server)).toBe(canonicalHost(proxy.server));
        expect(parsed.port).toBe(PORT);
        expect(proxy).toEqual(original);
        if (proxy.type === 'wireguard') {
            expect(authority.searchParams.get('address')).toContain('fd00::2/128');
            expect(authority.searchParams.get('address')).not.toContain('[');
        }
    });

    it.each(['http', 'hysteria'])(
        '%s URI formatting also preserves IPv6 without changing protocol support',
        (type) => {
            const url = convert({
                type,
                server: '2001:db8::1',
                port: PORT,
                username: 'alice',
                password: 'test',
                name: 'IPv6',
            });
            expect(new URL(url).hostname).toBe('[2001:db8::1]');
            expect(new URL(url).port).toBe(String(PORT));
        }
    );

    it.each(['2001:db8::1', '[2001:db8::1]', '203.0.113.9', 'edge.example.com'])(
        'keeps VMess JSON address separate from its port (%s)',
        (server) => {
            const url = convert({ type: 'vmess', name: 'VMess', server, port: PORT, uuid: UUID });
            const payload = JSON.parse(Buffer.from(url.slice(8), 'base64').toString('utf8'));
            expect(payload.add).toBe(bareHost(server));
            expect(Number(payload.port)).toBe(PORT);
            expect(urlToClashProxy(url).server).toBe(bareHost(server));
        }
    );

    it.each(['2001:db8::1', '[2001:db8::1]', '203.0.113.9', 'edge.example.com'])(
        'preserves SSR fields without URI brackets inside its encoded payload (%s)',
        (server) => {
            const proxy = {
                type: 'ssr',
                name: 'SSR IPv6',
                server,
                port: PORT,
                protocol: 'origin',
                cipher: 'aes-128-cfb',
                obfs: 'plain',
                password: 'p@ss:word',
            };
            const url = convert(proxy);
            const payload = Buffer.from(url.slice(6), 'base64').toString('utf8');
            expect(
                payload.startsWith(`${bareHost(server)}:${PORT}:origin:aes-128-cfb:plain:`)
            ).toBe(true);
            const parsed = urlToClashProxy(url);
            expect(parsed).toMatchObject({
                server: bareHost(server),
                port: PORT,
                password: 'p@ss:word',
                cipher: 'aes-128-cfb',
            });
            expect(parseNodeInfo(url).server).toBe(bareHost(server));
            expect(Number(parseNodeInfo(url).port)).toBe(PORT);
        }
    );
});

describe('sing-box import and legacy URI parsing', () => {
    it.each([undefined, null, false, 0])(
        'keeps rejecting a missing or falsy server (%s)',
        (server) => {
            const proxy = { type: 'trojan', name: 'Invalid', server, port: PORT, password: 'test' };
            expect(backendExport(proxy)).toBeNull();
            expect(frontendExport(proxy)).toBeNull();
            expect(
                singboxOutboundToUrl({ ...proxy, tag: 'Invalid', server_port: PORT })
            ).toBeNull();
        }
    );

    it('normalizes an already-bracketed address inside an older VMess JSON payload', () => {
        const url = `vmess://${Buffer.from(
            JSON.stringify({
                v: '2',
                ps: 'Legacy',
                add: '[2001:db8::1]',
                port: String(PORT),
                id: UUID,
            })
        ).toString('base64')}`;
        expect(urlToClashProxy(url)).toMatchObject({ server: '2001:db8::1', port: PORT });
        expect(parseNodeInfo(url).server).toBe('2001:db8::1');
    });

    it.each([
        { type: 'snell', psk: 'test-key' },
        { type: 'naive', username: 'alice', password: 'test' },
    ])('formats IPv6 boundaries for backend $type export', (proxy) => {
        const url = backendExport({ ...proxy, server: '2001:db8::1', port: PORT, name: 'IPv6' });
        expect(new URL(url).hostname).toBe('[2001:db8::1]');
        expect(new URL(url).port).toBe(String(PORT));
    });

    it('keeps special TUIC credentials separate from an IPv6 endpoint on sing-box import', () => {
        const url = singboxOutboundToUrl({
            type: 'tuic',
            tag: 'IPv6',
            server: '2001:db8::1',
            server_port: PORT,
            uuid: UUID,
            password: 'p@ss:word',
        });
        expect(urlToClashProxy(url)).toMatchObject({
            server: '2001:db8::1',
            port: PORT,
            password: 'p@ss:word',
        });
    });

    it.each(['vless', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'anytls', 'vmess'])(
        'preserves IPv6 when importing sing-box %s',
        (type) => {
            const url = singboxOutboundToUrl({
                type,
                tag: 'IPv6',
                server: '2001:db8::1',
                server_port: PORT,
                uuid: UUID,
                password: 'test-password',
                method: 'aes-128-gcm',
                security: 'auto',
            });
            const parsed = urlToClashProxy(url);
            expect(parsed).toMatchObject({ server: '2001:db8::1', port: PORT });
            if (type !== 'vmess') expect(new URL(url).hostname).toBe('[2001:db8::1]');
        }
    );

    it.each(['vless', 'trojan', 'hysteria2', 'tuic', 'socks5', 'wireguard'])(
        'recovers the explicit port in legacy unbracketed IPv6 %s URIs',
        (type) => {
            const auth =
                type === 'tuic'
                    ? `${UUID}:test`
                    : type === 'socks5'
                      ? 'alice:test'
                      : type === 'vless'
                        ? UUID
                        : 'test';
            const link = `${type}://${auth}@2001:db8::1:${PORT}#Legacy`;
            expect(urlToClashProxy(link)).toMatchObject({ server: '2001:db8::1', port: PORT });
            expect(parseNodeInfo(link).server).toBe('2001:db8::1');
            expect(Number(parseNodeInfo(link).port)).toBe(PORT);
        }
    );

    it('uses the usual default port for a bracketed IPv6 URI without an explicit port', () => {
        expect(urlToClashProxy(`vless://${UUID}@[2001:db8::1]#Default`)).toMatchObject({
            server: '2001:db8::1',
            port: 443,
        });
    });

    it('keeps IPv6 addresses distinct through YAML import and node operators', async () => {
        const proxies = ['2001:db8::1', '2001:db8::2'].map((server, index) => ({
            type: 'trojan',
            name: `IPv6-${index}`,
            server,
            port: PORT,
            password: 'test',
        }));
        const nodes = parseNodeList(yaml.dump({ proxies }));
        expect(nodes).toHaveLength(2);
        for (const node of nodes) expect(new URL(node.url).port).toBe(String(PORT));
        const transformed = await runOperatorChain(
            nodes.map((node) => node.url),
            [
                {
                    type: 'rename',
                    params: {
                        regex: {
                            enabled: true,
                            rules: [{ pattern: '^', replacement: 'Renamed-', flags: '' }],
                        },
                    },
                },
            ]
        );
        expect(transformed.map((url) => urlToClashProxy(url).server)).toEqual([
            '2001:db8::1',
            '2001:db8::2',
        ]);
        expect(transformed.every((url) => urlToClashProxy(url).port === PORT)).toBe(true);
    });
});
