import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { convertVlessToUrl } from '../../src/utils/protocols/converters/vless.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { extractValidNodes } from '../../functions/modules/utils/node-parser.js';
import { singboxOutboundToUrl } from '../../functions/modules/utils/singbox-to-url.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { generateBuiltinSingboxConfig } from '../../functions/modules/subscription/builtin-singbox-generator.js';
import { renderSingboxFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { ProcessorService } from '../../functions/services/processor-service.js';
import {
    determineTargetFormat,
    isHiddifyAgent,
} from '../../functions/modules/subscription/user-agent-utils.js';
import {
    resolveBuiltinRequestOptions,
    resolveEffectiveEngine,
} from '../../functions/modules/subscription/main-handler.js';

const KARING_UA =
    'Karing/1.2.26.2909 platform/windows;mihomo/1.19.28;ClashMeta;clash-verge;NekoBox/Android/1.4.1 (Prefer ClashMeta Format);HiddifyNext;v2ray;FLClash';
const VLESS_URL =
    'vless://11111111-1111-4111-8111-111111111111@edge.example.com:443?type=ws&security=tls&sni=edge.example.com&path=%2Fws&host=edge.example.com';
const PROXY = {
    name: 'VLESS Parameters',
    type: 'vless',
    server: 'edge.example.com',
    port: 443,
    uuid: '11111111-1111-4111-8111-111111111111',
    network: 'ws',
    tls: true,
    servername: 'edge.example.com',
    'ws-opts': { path: '/ws', headers: { Host: 'edge.example.com' } },
};

describe('VLESS parameter preservation', () => {
    it.each(['packet_encoding', 'packet-encoding', 'packetEncoding'])(
        'preserves the %s URL spelling through both converters and both output formats',
        (key) => {
            for (const value of ['xudp', 'packetaddr', '']) {
                const source = `${VLESS_URL}&${key}=${value}`;
                const proxy = urlToClashProxy(source);
                expect(proxy['packet-encoding']).toBe(value);
                for (const convert of [convertClashProxyToUrl, convertVlessToUrl]) {
                    const url = convert(proxy);
                    expect(urlToClashProxy(url)['packet-encoding']).toBe(value);
                    const clash = yaml.load(generateBuiltinClashConfig(url));
                    expect(clash.proxies[0]['packet-encoding']).toBe(value);
                    const singbox = JSON.parse(generateBuiltinSingboxConfig(url));
                    expect(
                        singbox.outbounds.find((node) => node.type === 'vless').packet_encoding
                    ).toBe(value);
                }
            }
        }
    );

    it.each(['packet_encoding', 'packet-encoding', 'packetEncoding'])(
        'preserves the %s proxy spelling in frontend and backend imports',
        (key) => {
            for (const convert of [convertClashProxyToUrl, convertVlessToUrl]) {
                const url = convert({ ...PROXY, [key]: 'packetaddr' });
                expect(urlToClashProxy(url)['packet-encoding']).toBe('packetaddr');
            }
            const [imported] = extractValidNodes(
                yaml.dump({
                    proxies: [{ ...PROXY, [key]: 'packetaddr' }],
                })
            );
            expect(urlToClashProxy(imported)['packet-encoding']).toBe('packetaddr');
        }
    );

    it('preserves explicit packet encoding from sing-box imports including the empty value', () => {
        for (const packet_encoding of ['packetaddr', 'xudp', '']) {
            const url = singboxOutboundToUrl({
                type: 'vless',
                tag: PROXY.name,
                server: PROXY.server,
                server_port: PROXY.port,
                uuid: PROXY.uuid,
                packet_encoding,
            });
            expect(urlToClashProxy(url)['packet-encoding']).toBe(packet_encoding);
            const result = JSON.parse(
                renderSingboxFromIniTemplate(
                    '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select',
                    { nodeList: url }
                )
            );
            expect(result.outbounds.find((node) => node.type === 'vless').packet_encoding).toBe(
                packet_encoding
            );
        }
    });

    it('leaves packet encoding unspecified when the source does not set it', () => {
        const proxy = urlToClashProxy(VLESS_URL);
        expect(proxy).not.toHaveProperty('packet-encoding');
        for (const convert of [convertClashProxyToUrl, convertVlessToUrl]) {
            expect(convert(proxy)).not.toMatch(/packet[-_]?encoding|packetEncoding/);
        }
        const result = JSON.parse(generateBuiltinSingboxConfig(VLESS_URL));
        expect(result.outbounds.find((node) => node.type === 'vless')).not.toHaveProperty(
            'packet_encoding'
        );
    });

    it('preserves VLESS encryption, TLS verification and ALPN through backend imports', () => {
        const proxy = {
            ...PROXY,
            encryption: 'test-encryption/with+reserved=characters',
            alpn: ['h2', 'http/1.1'],
            'skip-cert-verify': true,
        };
        const parsed = urlToClashProxy(convertClashProxyToUrl(proxy));
        expect(parsed).toMatchObject({
            encryption: proxy.encryption,
            alpn: proxy.alpn,
            'skip-cert-verify': true,
        });
    });

    it.each(['tls', 'reality'])(
        'preserves packet encoding and TLS options for VLESS %s output',
        (security) => {
            const source = {
                ...PROXY,
                'packet-encoding': 'packetaddr',
                alpn: ['h2', 'http/1.1'],
                'skip-cert-verify': true,
                ...(security === 'reality'
                    ? {
                          network: 'tcp',
                          'ws-opts': undefined,
                          flow: 'xtls-rprx-vision',
                          'reality-opts': { 'public-key': 'test-key', 'short-id': 'abcd' },
                      }
                    : {}),
            };
            for (const convert of [convertVlessToUrl, convertClashProxyToUrl]) {
                const url = convert(source);
                expect(urlToClashProxy(url)).toMatchObject({
                    'packet-encoding': 'packetaddr',
                    alpn: source.alpn,
                    'skip-cert-verify': true,
                });
                const builtin = JSON.parse(generateBuiltinSingboxConfig(url));
                const template = JSON.parse(
                    renderSingboxFromIniTemplate(
                        '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select',
                        { nodeList: url }
                    )
                );
                for (const output of [builtin, template]) {
                    expect(output.outbounds.find((node) => node.type === 'vless')).toMatchObject({
                        packet_encoding: 'packetaddr',
                        tls: { enabled: true, alpn: source.alpn, insecure: true },
                    });
                }
            }
        }
    );

    it('enables TLS in sing-box output when VLESS uses verified certificates', () => {
        const url = `${VLESS_URL}&packet_encoding=packetaddr&alpn=h2`;
        const result = JSON.parse(generateBuiltinSingboxConfig(url));
        const outbound = result.outbounds.find((node) => node.type === 'vless');
        expect(outbound.tls).toMatchObject({
            enabled: true,
            server_name: PROXY.server,
            alpn: ['h2'],
        });
        expect(outbound.tls.insecure).not.toBe(true);
    });

    it('preserves XHTTP Padding and request settings through frontend and backend round trips', () => {
        const extra = {
            xPaddingBytes: '100-1000',
            xPaddingObfsMode: false,
            xPaddingMethod: 'tokenish',
            xPaddingPlacement: 'queryInHeader',
            xPaddingHeader: 'X-Padding',
            xPaddingKey: 'padding+%&=',
            noGRPCHeader: false,
            scMaxEachPostBytes: '1048576',
            scMinPostsIntervalMs: '0',
        };
        const expected = {
            path: '/xhttp',
            host: PROXY.server,
            mode: 'packet-up',
            'x-padding-bytes': '100-1000',
            'x-padding-obfs-mode': false,
            'x-padding-method': 'tokenish',
            'x-padding-placement': 'queryInHeader',
            'x-padding-header': 'X-Padding',
            'x-padding-key': 'padding+%&=',
            'no-grpc-header': false,
            'sc-max-each-post-bytes': '1048576',
            'sc-min-posts-interval-ms': '0',
        };
        const source = `vless://${PROXY.uuid}@${PROXY.server}:443?type=xhttp&security=tls&host=${PROXY.server}&path=%2Fxhttp&mode=packet-up&packet_encoding=packetaddr&extra=${encodeURIComponent(JSON.stringify(extra))}`;
        const proxy = urlToClashProxy(source);
        expect(proxy['xhttp-opts']).toMatchObject(expected);
        for (const convert of [convertClashProxyToUrl, convertVlessToUrl]) {
            const url = convert(proxy);
            const parsed = urlToClashProxy(url);
            expect(parsed['packet-encoding']).toBe('packetaddr');
            expect(parsed['xhttp-opts']).toMatchObject(expected);
            expect(
                yaml.load(generateBuiltinClashConfig(url)).proxies[0]['xhttp-opts']
            ).toMatchObject(expected);
        }
    });

    it('ignores invalid XHTTP extra without rejecting the node', () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const extra of ['null', '[]', '"text"', '{invalid']) {
                const proxy = urlToClashProxy(
                    `${VLESS_URL.replace('type=ws', 'type=xhttp')}&extra=${encodeURIComponent(extra)}`
                );
                expect(proxy).toMatchObject({ type: 'vless', 'xhttp-opts': { path: '/ws' } });
            }
        } finally {
            warning.mockRestore();
        }
    });

    it('recognizes the Karing primary client despite its Hiddify compatibility tokens', () => {
        const params = new URLSearchParams();
        expect(determineTargetFormat(KARING_UA, params)).toBe('clash');
        expect(isHiddifyAgent(KARING_UA)).toBe(false);
        expect(
            resolveBuiltinRequestOptions({ searchParams: params, userAgent: KARING_UA })
        ).toMatchObject({ hiddifyCompatible: false });
        expect(
            resolveEffectiveEngine({
                searchParams: params,
                userAgent: KARING_UA,
                globalEngineMode: 'external',
            })
        ).toBe('external');
        expect(determineTargetFormat(KARING_UA, new URLSearchParams('target=singbox'))).toBe(
            'singbox'
        );
    });

    it('renders Karing VLESS parameters through the subscription output service', async () => {
        const searchParams = new URLSearchParams();
        const output = await ProcessorService.renderOutput({
            targetFormat: determineTargetFormat(KARING_UA, searchParams),
            combinedNodeList: `${VLESS_URL}&packet_encoding=packetaddr`,
            subName: 'Karing',
            config: {},
            builtinOptions: resolveBuiltinRequestOptions({ searchParams, userAgent: KARING_UA }),
        });
        expect(output.contentType).toContain('yaml');
        const config = yaml.load(output.content);
        expect(config.proxies[0]['packet-encoding']).toBe('packetaddr');
        expect(config).toHaveProperty('rule-providers');
    });
});
