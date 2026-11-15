import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import {
    xhttpExtraToClashOptions,
    clashXhttpOptionsToExtra,
} from '../../src/utils/protocols/common/vless-params.js';
import { normalizeXhttpHeaders } from '../../src/utils/protocols/common/xhttp-extra.js';
import { convertVlessToUrl } from '../../src/utils/protocols/converters/vless.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { extractValidNodes } from '../../functions/modules/utils/node-parser.js';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import {
    XHTTP_EXTRA,
    XHTTP_UUID,
    XHTTP_PUBLIC_KEY,
    xhttpLink,
} from '../fixtures/xhttp-advanced.js';

afterEach(() => vi.restoreAllMocks());
const EXTRA = structuredClone(XHTTP_EXTRA);
const expectedExtra = {
    ...EXTRA,
    xPaddingBytes: '100-1000',
    sessionIDLength: '16',
    uplinkChunkSize: '1024',
    scMinPostsIntervalMs: '0',
    xmux: { ...EXTRA.xmux, maxConnections: '3', maxConcurrency: '0', hMaxReusableSecs: '1800' },
};

describe('XHTTP extra typed mapping', () => {
    it('preserves all supported request and reuse fields without changing input', () => {
        const input = structuredClone(EXTRA);
        const options = xhttpExtraToClashOptions(input);
        expect(options).toMatchObject({
            'x-padding-obfs-mode': false,
            'no-grpc-header': false,
            'uplink-http-method': 'POST',
            'session-placement': 'header',
            'session-key': 'X-Session',
            'session-table': 'hex',
            'session-length': '16',
            'seq-placement': 'query',
            'seq-key': 'seq',
            'uplink-data-placement': 'header',
            'uplink-data-key': 'X-Data',
            'uplink-chunk-size': '1024',
            headers: EXTRA.headers,
            'reuse-settings': {
                'max-connections': '3',
                'max-concurrency': '0',
                'c-max-reuse-times': '0-5',
                'h-max-request-times': '600-900',
                'h-max-reusable-secs': '1800',
                'h-keep-alive-period': 0,
            },
        });
        expect(clashXhttpOptionsToExtra(options)).toEqual(expectedExtra);
        expect(input).toEqual(EXTRA);
    });

    it.each([
        ['xPaddingBytes', 'x-padding-bytes'],
        ['sessionIDLength', 'session-length'],
        ['scMaxEachPostBytes', 'sc-max-each-post-bytes'],
        ['scMinPostsIntervalMs', 'sc-min-posts-interval-ms'],
        ['uplinkChunkSize', 'uplink-chunk-size'],
    ])('normalizes %s numeric ranges in both directions', (xray, clash) => {
        for (const value of [0, 16, '100-200', '0']) {
            expect(xhttpExtraToClashOptions({ [xray]: value })[clash]).toBe(String(value));
            expect(clashXhttpOptionsToExtra({ [clash]: value })[xray]).toBe(String(value));
        }
        for (const value of [null, false, [], {}, NaN, Infinity]) {
            expect(xhttpExtraToClashOptions({ [xray]: value })).toEqual({});
            expect(clashXhttpOptionsToExtra({ [clash]: value })).toEqual({});
        }
    });

    it.each([true, false])('keeps explicitly set %s boolean flags', (value) => {
        const extra = { noGRPCHeader: value, xPaddingObfsMode: value };
        expect(clashXhttpOptionsToExtra(xhttpExtraToClashOptions(extra))).toEqual(extra);
    });

    it('normalizes legacy session fields with canonical names taking precedence', () => {
        const options = xhttpExtraToClashOptions({
            sessionPlacement: 'query',
            sessionKey: 'legacy',
            sessionIDPlacement: 'header',
            sessionIDKey: 'X-Session',
        });
        expect(options).toEqual({ 'session-placement': 'header', 'session-key': 'X-Session' });
        expect(clashXhttpOptionsToExtra(options)).toEqual({
            sessionIDPlacement: 'header',
            sessionIDKey: 'X-Session',
        });
        expect(
            xhttpExtraToClashOptions({ sessionPlacement: 'query', sessionKey: 'legacy' })
        ).toEqual({ 'session-placement': 'query', 'session-key': 'legacy' });
    });

    it.each([null, undefined, [], 'text', 1, false])(
        'ignores invalid extra/options objects (%j)',
        (input) => {
            expect(xhttpExtraToClashOptions(input)).toEqual({});
            expect(clashXhttpOptionsToExtra(input)).toEqual({});
        }
    );

    it.each([{}, { headers: {}, xmux: {} }, { xmux: { unsupported: 'value' } }])(
        'omits empty or unsupported reuse fields (%j)',
        (input) => {
            expect(xhttpExtraToClashOptions(input)).toEqual({});
            expect(
                clashXhttpOptionsToExtra({ 'reuse-settings': input.xmux || {}, path: '/upload' })
            ).toEqual({});
        }
    );

    it('rejects non-integer keepalive types without copying unknown fields', () => {
        expect(xhttpExtraToClashOptions({ xmux: { hKeepAlivePeriod: '60', unknown: 12 } })).toEqual(
            {}
        );
        expect(
            clashXhttpOptionsToExtra({
                'reuse-settings': { 'h-keep-alive-period': '60', unknown: true },
            })
        ).toEqual({});
    });
});

describe.each([
    ['frontend', convertVlessToUrl],
    ['backend', convertClashProxyToUrl],
])('%s XHTTP URL round trips', (_name, convert) => {
    it('keeps full extras, encryption, packet encoding and IPv6 through import/export', () => {
        const input = urlToClashProxy(xhttpLink());
        input.encryption = 'custom+encryption/=';
        const original = structuredClone(input);
        const url = convert(input);
        const params = new URL(url).searchParams;
        expect(params.get('encryption')).toBe(input.encryption);
        expect(params.get('packetEncoding')).toBe('packetaddr');
        expect(new URL(url).hostname).toBe('[2001:db8::1]');
        expect(JSON.parse(params.get('extra'))).toEqual(expectedExtra);
        expect(urlToClashProxy(url)['xhttp-opts']).toEqual(input['xhttp-opts']);
        expect(input).toEqual(original);
    });

    it.each(['Host', 'host', 'hOsT'])(
        'exports %s as the host parameter and sanitizes extra headers',
        (key) => {
            const proxy = {
                type: 'vless',
                uuid: XHTTP_UUID,
                server: 'edge.example',
                port: 443,
                network: 'xhttp',
                'xhttp-opts': {
                    path: '/up',
                    headers: { [key]: 'host.example', 'X-Valid': 'value', 'X-Invalid': 42 },
                },
            };
            const params = new URL(convert(proxy)).searchParams;
            expect(params.get('host')).toBe('host.example');
            expect(JSON.parse(params.get('extra')).headers).toEqual({ 'X-Valid': 'value' });
            expect(urlToClashProxy(convert(proxy))['xhttp-opts'].headers).toEqual({
                Host: 'host.example',
                'X-Valid': 'value',
            });
        }
    );

    it.each(['tls', 'reality', 'none'])(
        'preserves an explicit independent %s download stream',
        (security) => {
            const extra = {
                ...EXTRA,
                downloadSettings: {
                    address: 'download.example',
                    port: 8443,
                    network: 'xhttp',
                    security,
                    tlsSettings: {
                        serverName: 'tls-download.example',
                        fingerprint: 'safari',
                        alpn: 'h2, http/1.1',
                        allowInsecure: true,
                    },
                    realitySettings: {
                        serverName: 'reality-download.example',
                        publicKey: XHTTP_PUBLIC_KEY,
                        shortId: '1234',
                        fingerprint: 'firefox',
                    },
                    xhttpSettings: {
                        path: '/download',
                        host: 'download-host.example',
                        extra: {
                            headers: { 'X-Down': 'value' },
                            xmux: { maxConnections: 2, hKeepAlivePeriod: 20 },
                        },
                    },
                },
            };
            const proxy = urlToClashProxy(xhttpLink(extra, 'reality'));
            const ds = proxy['xhttp-opts']['download-settings'];
            expect(ds.tls).toBe(security !== 'none');
            if (security === 'tls')
                expect(ds).toMatchObject({
                    servername: 'tls-download.example',
                    alpn: ['h2', 'http/1.1'],
                    'skip-cert-verify': true,
                    'reality-opts': { 'public-key': '' },
                });
            if (security === 'reality')
                expect(ds).toMatchObject({
                    servername: 'reality-download.example',
                    'reality-opts': { 'public-key': XHTTP_PUBLIC_KEY, 'short-id': '1234' },
                    'skip-cert-verify': false,
                });
            if (security === 'none') expect(ds).not.toHaveProperty('servername');
            const roundtrip = urlToClashProxy(convert(proxy));
            expect(roundtrip['xhttp-opts']['download-settings']).toEqual(ds);
            const download = JSON.parse(
                new URL(convert(proxy)).searchParams.get('extra')
            ).downloadSettings;
            expect(download.network).toBe('xhttp');
            expect(download.xhttpSettings.extra.headers).toEqual({ 'X-Down': 'value' });
            expect(download.xhttpSettings.extra.xmux.maxConnections).toBe('2');
            expect(download.xhttpSettings.headers).toBeUndefined();
        }
    );

    it.each(['tls', 'reality', 'none'])(
        'materializes Clash downlink inheritance from %s uplink',
        (security) => {
            const proxy = urlToClashProxy(xhttpLink(EXTRA, security));
            proxy['xhttp-opts']['download-settings'] = { server: 'download.example', port: 8443 };
            const download = JSON.parse(
                new URL(convert(proxy)).searchParams.get('extra')
            ).downloadSettings;
            expect(download.network).toBe('xhttp');
            expect(download.security || 'none').toBe(security);
            expect(download.xhttpSettings.path).toBe('/upload');
            expect(download.xhttpSettings.host).toBe('upload.example');
            expect(download.xhttpSettings.extra.headers).toEqual(EXTRA.headers);
            const ds = urlToClashProxy(convert(proxy))['xhttp-opts']['download-settings'];
            expect(ds.tls).toBe(security !== 'none');
            if (security !== 'none') expect(ds.servername).toBe('upload-tls.example');
            if (security === 'reality')
                expect(ds['reality-opts']['public-key']).toBe(XHTTP_PUBLIC_KEY);
        }
    );

    it('does not inherit upload TLS/REALITY or headers into an independent default download', () => {
        const extra = {
            ...EXTRA,
            downloadSettings: { address: 'cdn.example', port: 80, network: 'xhttp' },
        };
        const input = urlToClashProxy(xhttpLink(extra, 'reality'));
        const ds = input['xhttp-opts']['download-settings'];
        expect(ds).toMatchObject({
            tls: false,
            path: '/',
            host: '',
            headers: {},
            'reuse-settings': {},
            'reality-opts': { 'public-key': '' },
        });
        expect(urlToClashProxy(convert(input))['xhttp-opts']['download-settings']).toEqual(ds);
        const download = JSON.parse(
            new URL(convert(input)).searchParams.get('extra')
        ).downloadSettings;
        expect(download.security).toBeUndefined();
        expect(download.xhttpSettings).toEqual({ path: '/' });
    });

    it('honors explicit empty TLS fields and a REALITY clear marker when exporting Clash downlink', () => {
        const proxy = urlToClashProxy(xhttpLink(EXTRA, 'reality'));
        proxy['xhttp-opts']['download-settings'] = {
            tls: true,
            servername: '',
            alpn: [],
            'skip-cert-verify': false,
            'client-fingerprint': '',
            'reality-opts': { 'public-key': '' },
            headers: {},
            host: '',
            'reuse-settings': {},
        };
        const download = JSON.parse(
            new URL(convert(proxy)).searchParams.get('extra')
        ).downloadSettings;
        expect(download.address).toBe('2001:db8::1');
        expect(download.port).toBe(443);
        expect(download.security).toBe('tls');
        expect(download.tlsSettings).toBeUndefined();
        const ds = urlToClashProxy(convert(proxy))['xhttp-opts']['download-settings'];
        expect(ds).toMatchObject({
            tls: true,
            servername: '',
            alpn: [],
            'skip-cert-verify': false,
            'reality-opts': { 'public-key': '' },
        });
    });

    it('emits no extra parameter for basic XHTTP options only', () => {
        const proxy = urlToClashProxy(xhttpLink({}));
        expect(new URL(convert(proxy)).searchParams.has('extra')).toBe(false);
    });
});

describe('XHTTP headers and download edge cases', () => {
    it.each(['Host', 'host', 'hOsT'])('gives explicit URL host precedence over extra %s', (key) => {
        const proxy = urlToClashProxy(
            xhttpLink({ headers: { [key]: 'extra-host.example', 'X-Key': 'value' } })
        );
        expect(proxy['xhttp-opts'].headers).toEqual({ Host: 'upload.example', 'X-Key': 'value' });
    });
    it('uses a header-only host when URI supplies no host or SNI', () => {
        const url = new URL(xhttpLink({ headers: { hOst: 'extra.example' } }));
        url.searchParams.delete('host');
        url.searchParams.delete('sni');
        const proxy = urlToClashProxy(url.toString());
        expect(proxy['xhttp-opts']).toMatchObject({
            host: 'extra.example',
            headers: { Host: 'extra.example' },
        });
    });
    it('deduplicates headers and discards non-string values without polluting object prototypes', () => {
        const headers = JSON.parse(
            '{"X-Key":"first","x-key":"last","Host":"first","host":"last","X-Number":42,"X-Array":["v"],"X-Null":null,"__proto__":"value"}'
        );
        const result = normalizeXhttpHeaders(headers);
        expect(result).toEqual({ 'x-key': 'last', Host: 'last', ['__proto__']: 'value' });
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect({}.value).toBeUndefined();
        expect(headers['X-Key']).toBe('first');
    });
    it('uses download extra headers instead of outer headers when Xray extra replaces the body', () => {
        const options = xhttpExtraToClashOptions({
            downloadSettings: {
                xhttpSettings: {
                    headers: { 'X-Outer': 'discard' },
                    extra: {
                        headers: { 'X-Inner': 'keep', Host: 'discard-host' },
                        xmux: { maxConnections: 2 },
                    },
                },
            },
        });
        expect(options['download-settings'].headers).toEqual({ 'X-Inner': 'keep' });
    });
    it('handles download security blocks according to security, including missing settings', () => {
        const options = xhttpExtraToClashOptions({
            downloadSettings: { security: 'TLS', realitySettings: { publicKey: 'ignored' } },
        });
        expect(options['download-settings']).toMatchObject({
            tls: true,
            servername: '',
            'client-fingerprint': 'chrome',
            alpn: [],
            'skip-cert-verify': false,
        });
        expect(options['download-settings']).not.toHaveProperty('reality-opts');
    });
    it('warns and prevents inheriting the uplink key when a REALITY downlink lacks a public key', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const proxy = urlToClashProxy(
            xhttpLink(
                { downloadSettings: { security: 'reality', realitySettings: { shortId: '1234' } } },
                'reality'
            )
        );
        expect(proxy['xhttp-opts']['download-settings']['reality-opts']['public-key']).toBe('');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('缺少 publicKey'));
    });
    it.each(['null', '[]', '"text"', '{invalid'])(
        'keeps basic XHTTP configuration for invalid extra %s',
        (extra) => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const url = new URL(xhttpLink());
            url.searchParams.set('extra', extra);
            const proxy = urlToClashProxy(url.toString());
            expect(proxy['xhttp-opts']).toMatchObject({
                path: '/upload',
                host: 'upload.example',
                mode: 'packet-up',
            });
            expect(proxy).not.toBeNull();
        }
    );
});

describe('XHTTP subscription output integration', () => {
    it.each(['tls', 'reality', 'none'])(
        'preserves extras through Clash YAML import and built-in/template output (%s)',
        (security) => {
            const original = urlToClashProxy(
                xhttpLink(
                    {
                        ...EXTRA,
                        downloadSettings: {
                            address: 'cdn.example',
                            port: 443,
                            network: 'xhttp',
                            security: 'tls',
                            xhttpSettings: { path: '/download' },
                        },
                    },
                    security
                )
            );
            const links = extractValidNodes(yaml.dump({ proxies: [original] }));
            expect(links).toHaveLength(1);
            const imported = urlToClashProxy(links[0]);
            expect(imported['xhttp-opts']).toEqual(original['xhttp-opts']);
            const builtin = yaml.load(generateBuiltinClashConfig(links.join('\n')));
            const template = yaml.load(
                renderClashFromIniTemplate(
                    '[Proxy Group]\nSelect = select, .*\n[Rule]\nMATCH,Select',
                    { nodeList: links.join('\n') }
                )
            );
            for (const result of [builtin, template]) {
                expect(result.proxies[0]['xhttp-opts']).toEqual(original['xhttp-opts']);
                expect(result.proxies[0]['packet-encoding']).toBe('packetaddr');
                expect(result.proxies[0].encryption).toBe('none');
            }
        }
    );
});
