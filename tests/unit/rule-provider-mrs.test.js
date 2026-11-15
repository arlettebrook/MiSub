import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { renderClashFromTemplateModel } from '../../functions/modules/subscription/template-renderers/render-clash.js';
import { ProcessorService } from '../../functions/services/processor-service.js';

const NODE = 'trojan://synthetic@edge.example:443#Test';
const MODEL = { proxies: [], groups: [], settings: {}, rules: [] };
function renderUrls(urls, syntax = 'ruleset') {
    const rules =
        syntax === 'ruleset'
            ? '[custom]\n' + urls.map((url) => `ruleset=DIRECT,${url}`).join('\n')
            : '[Rule]\n' + urls.map((url) => `RULE-SET,${url},DIRECT`).join('\n');
    return yaml.load(renderClashFromIniTemplate(rules, { nodeList: NODE }));
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('MRS rule provider rendering', () => {
    it.each([
        ['https://rules.example/geosite/cn.mrs', 'domain'],
        ['https://rules.example/geoip/cn.mrs', 'ipcidr'],
        ['https://rules.example/GeoIP/CN.MRS', 'ipcidr'],
        ['https://rules.example/ads.mrs', 'domain'],
        ['https://rules.example/geosite/ads.MRS?token=test&format=yaml#hash', 'domain'],
        ['https://rules.example/geoip/cn.mrs?version=1#rule', 'ipcidr'],
        ['https://geoip.example/geosite/cn.mrs', 'domain'],
        ['https://rules.example/custom.mrs?path=/geoip/', 'domain'],
        ['https://rules.example/geoip-name.mrs', 'domain'],
    ])('selects format, behavior and path for %s', (url, behavior) => {
        const config = renderUrls([url]);
        const [name, provider] = Object.entries(config['rule-providers'])[0];
        expect(provider).toEqual({
            type: 'http',
            format: 'mrs',
            behavior,
            url,
            path: `./ruleset/${name}.mrs`,
            interval: 86400,
        });
        expect(provider.behavior).not.toBe('classical');
        expect(name).not.toContain('_mrs');
        expect(config.rules).toContain(`RULE-SET,${name},DIRECT`);
    });

    it.each(['ruleset', 'rule'])('supports %s INI rules without fetching providers', (syntax) => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const config = renderUrls(
            ['https://rules.example/geoip/cn.mrs', 'https://rules.example/geosite/cn.mrs'],
            syntax
        );
        const providers = Object.values(config['rule-providers']);
        expect(providers.map((provider) => provider.behavior)).toEqual(['ipcidr', 'domain']);
        expect(fetch).not.toHaveBeenCalled();
        expect(config.proxies[0].name).toContain('Test');
    });

    it('deduplicates repeated URLs while preserving different sets with the same basename', () => {
        const domain = 'https://rules.example/geosite/cn.mrs';
        const ip = 'https://rules.example/geoip/cn.mrs';
        const config = renderUrls([domain, domain, ip]);
        expect(Object.keys(config['rule-providers'])).toEqual(['cn_0', 'cn_1']);
        expect(config['rule-providers'].cn_0).toMatchObject({
            behavior: 'domain',
            path: './ruleset/cn_0.mrs',
        });
        expect(config['rule-providers'].cn_1).toMatchObject({
            behavior: 'ipcidr',
            path: './ruleset/cn_1.mrs',
        });
        expect(config.rules.filter((rule) => rule.startsWith('RULE-SET,'))).toEqual([
            'RULE-SET,cn_0,DIRECT',
            'RULE-SET,cn_0,DIRECT',
            'RULE-SET,cn_1,DIRECT',
        ]);
    });

    it('preserves URL queries and Unicode basenames safely in cache paths', () => {
        const url = 'https://rules.example/geosite/广告.mrs?token=a%2Fb%26c#version';
        const config = renderUrls([url]);
        const [name, provider] = Object.entries(config['rule-providers'])[0];
        expect(provider.url).toBe(url);
        expect(name).toMatch(/^[a-z0-9_]+$/);
        expect(provider.path).toBe(`./ruleset/${name}.mrs`);
        expect(provider.path).not.toMatch(/[?%#]/);
    });

    it.each([
        ['https://rules.example/domain.yaml', undefined, 'yaml', 'classical'],
        ['https://rules.example/domain.yml?version=1', undefined, 'yaml', 'classical'],
        ['https://rules.example/domain.list', 'text', 'list', 'classical'],
        ['https://rules.example/domain.txt?version=1#hash', 'text', 'list', 'classical'],
        ['https://rules.example/rules.yaml?file=domain.mrs', undefined, 'yaml', 'classical'],
        ['https://rules.example/rules.list?file=domain.mrs', 'text', 'list', 'classical'],
    ])('retains YAML/text provider semantics for %s', (url, format, extension, behavior) => {
        const [provider] = Object.values(renderUrls([url])['rule-providers']);
        expect(provider).toMatchObject({ url, behavior });
        expect(provider.format).toBe(format);
        expect(provider.path).toMatch(new RegExp(`\\.${extension}$`));
    });

    it('retains ACL4SSR URL mapping, IP CIDR behavior and text-only exceptions', () => {
        const config = renderUrls([
            'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaIP.list',
            'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list',
        ]);
        const providers = Object.values(config['rule-providers']);
        expect(providers[0]).toMatchObject({ behavior: 'ipcidr' });
        expect(providers[0].url).toContain('/Clash/Providers/ChinaIP.yaml');
        expect(providers[0].format).toBeUndefined();
        expect(providers[1]).toMatchObject({ behavior: 'classical', format: 'text' });
        expect(providers[1].url).toContain('/Clash/LocalAreaNetwork.list');
    });

    it('supports direct model rendering and does not mutate the input', () => {
        const model = structuredClone({
            ...MODEL,
            rules: [
                {
                    type: 'rule-set',
                    policy: 'DIRECT',
                    value: 'https://rules.example/geoip/test.mrs',
                },
            ],
        });
        const original = structuredClone(model);
        expect(
            Object.values(yaml.load(renderClashFromTemplateModel(model))['rule-providers'])[0]
        ).toMatchObject({ format: 'mrs', behavior: 'ipcidr' });
        expect(model).toEqual(original);
    });
});

describe('MRS subscription template integration', () => {
    it('renders a remote INI template with the correct provider declarations', async () => {
        const template =
            '[custom]\nruleset=DIRECT,https://rules.example/geosite/cn.mrs\nruleset=DIRECT,https://rules.example/geoip/cn.mrs?version=1';
        const fetch = vi.fn(async () => new Response(template));
        vi.stubGlobal('fetch', fetch);
        const store = new Map();
        const storageAdapter = {
            get: async (key) => store.get(key) ?? null,
            put: async (key, value) => store.set(key, value),
        };
        const result = await ProcessorService.renderOutput({
            targetFormat: 'clash',
            combinedNodeList: NODE,
            subName: 'MRS Test',
            config: {},
            builtinOptions: {},
            templateSource: { kind: 'remote', value: 'https://templates.example/mrs.ini' },
            storageAdapter,
        });
        const config = yaml.load(result.content);
        expect(
            Object.values(config['rule-providers']).map((provider) => [
                provider.format,
                provider.behavior,
            ])
        ).toEqual([
            ['mrs', 'domain'],
            ['mrs', 'ipcidr'],
        ]);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe('https://templates.example/mrs.ini');
    });

    it('preserves explicit MRS providers in a remote Clash YAML profile', async () => {
        const template = {
            'proxy-groups': [{ name: 'Select', type: 'select', proxies: ['DIRECT'] }],
            'rule-providers': {
                customIP: {
                    type: 'http',
                    behavior: 'ipcidr',
                    format: 'mrs',
                    url: 'https://rules.example/custom.mrs',
                    path: './custom/ip.mrs',
                    interval: 600,
                },
            },
            rules: ['RULE-SET,customIP,Select'],
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(yaml.dump(template)))
        );
        const result = await ProcessorService.renderOutput({
            targetFormat: 'clash',
            combinedNodeList: NODE,
            subName: 'MRS Test',
            config: {},
            builtinOptions: {},
            templateSource: { kind: 'remote', value: 'https://templates.example/profile.yaml' },
            storageAdapter: { get: async () => null, put: async () => {} },
        });
        expect(yaml.load(result.content)['rule-providers']).toEqual(template['rule-providers']);
    });
});
