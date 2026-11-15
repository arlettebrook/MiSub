import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { parseIniTemplate } from '../../functions/modules/subscription/template-parsers/ini-template-parser.js';
import {
    applyMihomoChainProxy,
    applyMihomoChainProxyToClashConfig,
} from '../../functions/modules/subscription/mihomo-chain-proxy.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { renderClashFromTemplateModel } from '../../functions/modules/subscription/template-renderers/render-clash.js';
import {
    renderClashYamlProfileTemplate,
    isClashYamlProfileTemplate,
    ProcessorService,
} from '../../functions/services/processor-service.js';
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
const PROXIES = [
    {
        name: 'HK-01',
        type: 'trojan',
        server: 'hk.example',
        port: 443,
        password: 'secret',
        tls: true,
        'ws-opts': { path: '/ws', headers: { Host: 'host.example' } },
    },
    {
        name: 'US-01',
        type: 'http',
        server: 'us.example',
        port: 8080,
        username: 'user',
        password: 'secret',
    },
];
const NODES = 'trojan://secret@hk.example:443#HK-01\nhttp://user:secret@us.example:8080#US-01';
const CHAIN = { group: 'Landing', entry: 'Entry', prefix: 'Chain: ' };
const INI =
    '[custom]\ncustom_chain_proxy=Landing`Entry`Chain: \n[Proxy Group]\nEntry = select, HK-01, US-01\nLanding = select, Entry\n[Rule]\nMATCH,Landing';
const YAML = {
    'proxy-groups': [
        { name: 'Entry', type: 'select', 'include-all-proxies': true },
        { name: 'Landing', type: 'select', proxies: [] },
    ],
    'x-misub-chain-proxy': {
        'entry-group': 'Entry',
        'landing-group': 'Landing',
        'clone-prefix': 'Chain: ',
    },
    rules: ['MATCH,Landing'],
};
const model = (changes = {}) => ({
    proxies: structuredClone(PROXIES),
    groups: [],
    meta: { isMeta: true },
    settings: {},
    rules: [],
    extras: { chainProxy: [CHAIN] },
    ...changes,
});
const render = (template = INI, isMeta = true, proxies = PROXIES) =>
    yaml.load(
        renderClashFromIniTemplate(template, {
            proxies: structuredClone(proxies),
            ruleLevel: 'none',
            isMeta,
        })
    );
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('custom INI chain rendering', () => {
    it('adds dialer-proxy copies and keeps originals intact', () => {
        const config = render();
        expect(config.proxies).toHaveLength(4);
        const copies = config.proxies.slice(2);
        expect(copies.map((proxy) => proxy.name)).toEqual(['Chain: HK-01', 'Chain: US-01']);
        expect(copies.every((proxy) => proxy['dialer-proxy'] === 'Entry')).toBe(true);
        expect(config.proxies[0]).toEqual(PROXIES[0]);
        expect(config['proxy-groups'].find((group) => group.name === 'Landing')).toMatchObject({
            type: 'select',
            proxies: copies.map((proxy) => proxy.name),
        });
        expect(config['proxy-groups'].find((group) => group.name === 'Entry').proxies).toEqual([
            'HK-01',
            'US-01',
        ]);
        expect(config.rules).toContain('MATCH,Landing');
        expect(config['proxy-groups'].some((group) => group.type === 'relay')).toBe(false);
    });
    it.each([false, true])(
        'creates missing groups before rules can be pruned (Meta=%s)',
        (isMeta) => {
            const config = render(
                '[custom]\n  custom_chain_proxy = Landing`Entry\n[Rule]\nMATCH,Landing',
                isMeta
            );
            expect(config['proxy-groups'].map((group) => group.name)).toEqual(
                expect.arrayContaining(['Landing', 'Entry'])
            );
            expect(config.rules).toContain('MATCH,Landing');
            expect(config.proxies).toHaveLength(isMeta ? 4 : 2);
            if (!isMeta)
                expect(
                    config['proxy-groups'].find((group) => group.name === 'Landing').proxies
                ).toEqual(['HK-01', 'US-01']);
        }
    );
    it('preserves plain Clash fallback without chain copies', () => {
        const config = render(INI, false);
        expect(config.proxies).toEqual(PROXIES);
        expect(config['proxy-groups'].find((group) => group.name === 'Landing').proxies).toEqual([
            'Entry',
        ]);
        expect(config.proxies.some((proxy) => proxy['dialer-proxy'])).toBe(false);
    });
    it('preserves whitespace in custom prefixes and case-insensitive indented directives', () => {
        const config = render(
            '[custom]\n  CUSTOM_CHAIN_PROXY = Landing`Entry`Prefix: \n[Rule]\nMATCH,Landing'
        );
        expect(config.proxies[2].name).toBe('Prefix: HK-01');
    });
    it('keeps Meta capability in the normalized model', () => {
        const parsed = parseIniTemplate(INI, { proxies: structuredClone(PROXIES), isMeta: true });
        expect(parsed.meta.isMeta).toBe(true);
        expect(yaml.load(renderClashFromTemplateModel(parsed)).proxies).toHaveLength(4);
    });
    it('renders shared models repeatedly without mutation or extra copies', () => {
        const input = model();
        const original = structuredClone(input);
        expect(renderClashFromTemplateModel(input)).toBe(renderClashFromTemplateModel(input));
        expect(input).toEqual(original);
        const once = applyMihomoChainProxy(input, { enableDialerProxy: true });
        expect(applyMihomoChainProxy(once, { enableDialerProxy: true })).toEqual(once);
        once.proxies[2]['ws-opts'].headers.Host = 'changed';
        expect(input.proxies[0]['ws-opts'].headers.Host).toBe('host.example');
    });
    it('reserves proxy and group names when naming copies', () => {
        const config = render(INI + '\n[Proxy Group]\nChain: HK-01 = select, HK-01', true, [
            ...PROXIES,
            { ...PROXIES[1], name: 'Chain: US-01' },
        ]);
        expect(
            new Set([
                ...config.proxies.map((proxy) => proxy.name),
                ...config['proxy-groups'].map((group) => group.name),
            ]).size
        ).toBe(config.proxies.length + config['proxy-groups'].length);
        expect(config.proxies.some((proxy) => proxy.name === 'Chain: HK-01 (2)')).toBe(true);
        expect(config.proxies.some((proxy) => proxy.name === 'Chain: US-01 (2)')).toBe(true);
    });
    it('supports independent chains sharing the same safe entry group', () => {
        const config = render(INI + '\n[custom]\ncustom_chain_proxy=Landing2`Entry`Second: \n');
        expect(config.proxies).toHaveLength(6);
        expect(config['proxy-groups'].find((group) => group.name === 'Entry').proxies).toEqual([
            'HK-01',
            'US-01',
        ]);
        expect(config['proxy-groups'].find((group) => group.name === 'Landing2').proxies).toEqual([
            'Second: HK-01',
            'Second: US-01',
        ]);
    });
    it('deduplicates identical declarations', () => {
        expect(
            render(INI + '\n[custom]\ncustom_chain_proxy=Landing`Entry`Chain: ').proxies
        ).toHaveLength(4);
    });
    it('handles an empty node list without empty or dangling groups', () => {
        const config = render(
            '[custom]\ncustom_chain_proxy=Landing`Entry\n[Rule]\nMATCH,Landing',
            true,
            []
        );
        expect(config.proxies).toEqual([]);
        expect(config['proxy-groups'].find((group) => group.name === 'Landing').proxies).toEqual([
            'DIRECT',
        ]);
        expect(config.rules).toContain('MATCH,Landing');
    });
    it('leaves templates without declarations unchanged', () => {
        const input = model({ extras: {} });
        expect(applyMihomoChainProxy(input, { enableDialerProxy: true })).toBe(input);
        expect(yaml.load(renderClashFromTemplateModel(input)).proxies).toEqual(PROXIES);
    });
});

describe('chain loop prevention', () => {
    it('flattens nested entry selectors and excludes landing/self references', () => {
        const config = applyMihomoChainProxy(
            model({
                groups: [
                    {
                        name: 'Entry',
                        type: 'select',
                        members: ['Nested', 'Landing', 'Entry'],
                        options: { use: ['pool'], 'include-all-proxies': true },
                    },
                    { name: 'Nested', type: 'select', members: ['HK-01', 'Landing'], options: {} },
                ],
            }),
            { enableDialerProxy: true }
        );
        const entry = config.groups.find((group) => group.name === 'Entry');
        expect(entry.members).toEqual(['HK-01', 'US-01']);
        expect(entry.options).toEqual({});
        expect(entry.filters).toEqual([]);
    });
    it('materializes entry filters against only original proxies', () => {
        const config = applyMihomoChainProxy(
            model({
                groups: [
                    {
                        name: 'Entry',
                        type: 'url-test',
                        members: [],
                        options: {
                            'include-all': true,
                            filter: '(?i)^HK',
                            'exclude-filter': 'nothing',
                            url: 'http://local.test',
                        },
                    },
                ],
            }),
            { enableDialerProxy: true }
        );
        const entry = config.groups.find((group) => group.name === 'Entry');
        expect(entry.members).toEqual(['HK-01']);
        expect(entry.options).toEqual({ url: 'http://local.test' });
    });
    it('excludes an original proxy whose existing dialer reaches the landing indirectly', () => {
        const proxies = structuredClone(PROXIES);
        proxies[0]['dialer-proxy'] = 'Helper';
        const input = model({
            proxies,
            groups: [{ name: 'Helper', type: 'select', members: ['Landing'], options: {} }],
        });
        const result = applyMihomoChainProxy(input, { enableDialerProxy: true });
        expect(result.groups.find((group) => group.name === 'Entry').members).toEqual(['US-01']);
        expect(result.proxies[0]['dialer-proxy']).toBe('Helper');
        expect(result.proxies[2]['dialer-proxy']).toBe('Entry');
    });
    it('preserves safe existing dialers without rewriting originals', () => {
        const proxies = structuredClone(PROXIES);
        proxies[0]['dialer-proxy'] = 'US-01';
        const result = applyMihomoChainProxy(model({ proxies }), { enableDialerProxy: true });
        expect(result.groups.find((group) => group.name === 'Entry').members).toEqual([
            'HK-01',
            'US-01',
        ]);
        expect(result.proxies[0]['dialer-proxy']).toBe('US-01');
    });
    it('rejects a chain when all original entry nodes have cyclic dialers', () => {
        const proxies = structuredClone(PROXIES);
        proxies[0]['dialer-proxy'] = 'US-01';
        proxies[1]['dialer-proxy'] = 'HK-01';
        expect(() =>
            applyMihomoChainProxy(model({ proxies }), { enableDialerProxy: true })
        ).toThrow(/no safe original entry/);
    });
    it.each(
        [
            [{ group: 'Entry', entry: 'Entry' }],
            [{ group: 'Landing' }],
            [{ group: 'Landing', entry: 'Entry', prefix: 42 }],
            [
                { group: 'Landing', entry: 'Entry' },
                { group: 'Landing', entry: 'Other' },
            ],
            [
                { group: 'Landing', entry: 'Entry' },
                { group: 'Entry', entry: 'Other' },
            ],
            [{ group: 'DIRECT', entry: 'Entry' }],
            [{ group: 'HK-01', entry: 'Entry' }],
        ].map((chainProxy) => ({ chainProxy }))
    )('rejects invalid declarations $chainProxy', ({ chainProxy }) => {
        expect(() =>
            applyMihomoChainProxy(model({ extras: { chainProxy } }), { enableDialerProxy: true })
        ).toThrow(/Invalid MiSub chain proxy/);
    });
    it.each(['[', '^NoSuchNode'])('rejects invalid or empty entry filters (%s)', (filter) => {
        expect(() =>
            applyMihomoChainProxy(
                model({
                    groups: [{ name: 'Entry', type: 'select', members: [], filters: [filter] }],
                }),
                { enableDialerProxy: true }
            )
        ).toThrow(/filter/);
    });
});

describe('YAML profile chain declarations', () => {
    it.each([false, true])(
        'expands only for Meta and removes the extension (Meta=%s)',
        (isMeta) => {
            const output = yaml.load(
                renderClashYamlProfileTemplate(yaml.dump(YAML), NODES, {
                    isMeta,
                    addFlagEmoji: false,
                })
            );
            expect(output.proxies).toHaveLength(isMeta ? 4 : 2);
            expect(output['x-misub-chain-proxy']).toBeUndefined();
            const entry = output['proxy-groups'].find((group) => group.name === 'Entry');
            expect(entry.proxies).toEqual(['HK-01', 'US-01']);
            expect(entry['include-all-proxies']).toBeUndefined();
        }
    );
    it('supports missing groups and documented long-name YAML fields', () => {
        const input = { ...YAML };
        delete input['proxy-groups'];
        expect(isClashYamlProfileTemplate(yaml.dump(input))).toBe(true);
        const output = yaml.load(
            renderClashYamlProfileTemplate(yaml.dump(input), NODES, {
                isMeta: true,
                addFlagEmoji: false,
            })
        );
        expect(output['proxy-groups'].map((group) => group.name)).toEqual(['Entry', 'Landing']);
        expect(output.proxies[2]['dialer-proxy']).toBe('Entry');
    });
    it('preserves unrelated provider declarations and group options exactly', () => {
        const input = {
            ...YAML,
            proxies: structuredClone(PROXIES),
            'rule-providers': { AI: { type: 'http', format: 'mrs', behavior: 'domain' } },
            'proxy-groups': [
                ...YAML['proxy-groups'],
                {
                    name: 'Other',
                    type: 'url-test',
                    'include-all': true,
                    filter: 'US',
                    url: 'http://example.test',
                    interval: 300,
                    icon: 'icon',
                },
            ],
        };
        const original = structuredClone(input);
        const output = applyMihomoChainProxyToClashConfig(input, { enableDialerProxy: true });
        expect(output['rule-providers']).toEqual(input['rule-providers']);
        expect(output['proxy-groups'][2]).toEqual(input['proxy-groups'][2]);
        expect(input).toEqual(original);
    });
    it('supports arrays of short-name YAML declarations and prevents prefix collisions', () => {
        const input = {
            proxies: structuredClone(PROXIES),
            'proxy-groups': [],
            'x-misub-chain-proxy': [CHAIN, { group: 'Second', entry: 'Entry', prefix: 'Chain: ' }],
        };
        const output = applyMihomoChainProxyToClashConfig(input, { enableDialerProxy: true });
        expect(output.proxies).toHaveLength(6);
        expect(new Set(output.proxies.map((proxy) => proxy.name)).size).toBe(6);
        expect(output.proxies[4].name).toBe('Chain: HK-01 (2)');
    });
    it('repeated YAML rendering is stable and template input is unchanged', () => {
        const text = yaml.dump(YAML);
        expect(renderClashYamlProfileTemplate(text, NODES, { isMeta: true })).toBe(
            renderClashYamlProfileTemplate(text, NODES, { isMeta: true })
        );
    });
});

describe('chain subscription integration', () => {
    it.each(['ini', 'yaml'])(
        'supports Meta detection and plain fallback on actual %s subscription requests',
        async (format) => {
            const store = new Map([
                [
                    'worker_settings_v1',
                    {
                        mytoken: 'chain-test',
                        enableAccessLog: false,
                        enableFlagEmoji: false,
                        transformConfigMode: 'remote',
                        transformConfig: `https://templates.example/chain.${format}`,
                        defaultPrefixSettings: {
                            enableSubscriptions: false,
                            enableManualNodes: false,
                        },
                    },
                ],
                [
                    'misub_subscriptions_v1',
                    NODES.split('\n').map((url, index) => ({
                        id: `node-${index}`,
                        enabled: true,
                        url,
                    })),
                ],
                ['misub_profiles_v1', []],
            ]);
            createAdapter.mockReturnValue({
                get: async (key) => store.get(key) ?? null,
                put: async (key, value) => store.set(key, value),
                getAllSubscriptions: async () => store.get('misub_subscriptions_v1'),
                getAllProfiles: async () => [],
            });
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response(format === 'ini' ? INI : yaml.dump(YAML)))
            );
            for (const [ua, parameter, expanded] of [
                ['mihomo/1.19.34', '', true],
                ['Clash-for-Windows', '', false],
                ['Clash-for-Windows', '&meta=true', true],
            ]) {
                const response = await handleMisubRequest({
                    request: new Request(
                        `https://misub.example/chain-test?target=clash${parameter}`,
                        { headers: { 'User-Agent': ua } }
                    ),
                    env: {},
                    waitUntil: () => {},
                });
                expect(response.status).toBe(200);
                const config = yaml.load(await response.text());
                expect(
                    config.proxies.filter((proxy) => proxy['dialer-proxy'] === 'Entry')
                ).toHaveLength(expanded ? 2 : 0);
                expect(config['x-misub-chain-proxy']).toBeUndefined();
                expect(config['proxy-groups'].some((group) => group.name === 'Landing')).toBe(true);
            }
        }
    );
    it.each(['ini', 'yaml'])(
        'renders a remote %s template locally through ProcessorService',
        async (format) => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response(format === 'ini' ? INI : yaml.dump(YAML)))
            );
            const result = await ProcessorService.renderOutput({
                targetFormat: 'clash',
                combinedNodeList: NODES,
                config: {},
                builtinOptions: { isMeta: true, addFlagEmoji: false },
                subName: 'Chain',
                templateSource: { kind: 'remote', value: `https://example.test/chain.${format}` },
                storageAdapter: { get: async () => null, put: async () => {} },
            });
            expect(yaml.load(result.content).proxies).toHaveLength(4);
            expect(fetch).toHaveBeenCalledTimes(1);
        }
    );
    it.each(['ini', 'yaml'])(
        'returns a controlled error for invalid %s chains in formal requests',
        async (format) => {
            const store = new Map([
                [
                    'worker_settings_v1',
                    {
                        mytoken: 'chain-test',
                        enableAccessLog: false,
                        transformConfigMode: 'remote',
                        transformConfig: `https://templates.example/invalid.${format}`,
                        subscription: {
                            engineMode: 'builtin',
                            defaultTemplate: `https://templates.example/invalid.${format}`,
                        },
                    },
                ],
                [
                    'misub_subscriptions_v1',
                    [{ id: 'node', enabled: true, url: NODES.split('\n')[0] }],
                ],
                ['misub_profiles_v1', []],
            ]);
            createAdapter.mockReturnValue({
                get: async (key) => store.get(key) ?? null,
                put: async (key, value) => store.set(key, value),
                getAllSubscriptions: async () => store.get('misub_subscriptions_v1'),
                getAllProfiles: async () => [],
            });
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.stubGlobal(
                'fetch',
                vi.fn(
                    async () =>
                        new Response(
                            format === 'ini'
                                ? '[custom]\ncustom_chain_proxy=Entry`Entry'
                                : yaml.dump({
                                      ...YAML,
                                      'x-misub-chain-proxy': {
                                          'entry-group': 'Entry',
                                          'landing-group': 'Entry',
                                      },
                                  })
                        )
                )
            );
            const response = await handleMisubRequest({
                request: new Request(
                    `https://misub.example/chain-test?target=clash&meta=true&template=${encodeURIComponent(`https://templates.example/invalid.${format}`)}`,
                    { headers: { 'User-Agent': 'ClashMeta' } }
                ),
                env: {},
                waitUntil: () => {},
            });
            expect(response.status).toBe(422);
            expect((await response.json()).error).toContain('entry and landing groups must differ');
        }
    );
});
