// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { COUNTRY_REGISTRY } from '../../shared/country-registry.js';
import { createRegionResolver } from '../../shared/node-region-context.js';
import { identifyNodeRegion } from '../../shared/node-regions.js';
import { resolveNodeFlagPolicy } from '../../shared/node-flag-policy.js';
import { addFlagEmoji, removeFlagEmoji } from '../../functions/utils/node-utils.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import * as subscriptionService from '../../functions/services/subscription-service.js';

const createAdapter = vi.fn();
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: async () => 'kv',
        resolveKV: () => null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));
const uri = (name) => `trojan://pass@example.com:443#${encodeURIComponent(name)}`;
function setup({ name = '🏁 🌍 US-01', settings = {}, profile = {} } = {}) {
    const node = { id: 'node', enabled: true, url: uri(name) };
    const group = {
        id: 'group',
        name: 'Flags',
        enabled: true,
        subscriptions: [],
        manualNodes: ['node'],
        ...profile,
    };
    const config = {
        mytoken: 'token',
        profileToken: 'profiles',
        enableAccessLog: false,
        enableTrafficNode: false,
        defaultPrefixSettings: { enableManualNodes: false, enableSubscriptions: false },
        ...settings,
    };
    const store = new Map([['worker_settings_v1', config]]);
    const adapter = {
        get: async (key) => store.get(key) || null,
        put: async (key, value) => {
            store.set(key, value);
            return true;
        },
        getAllProfiles: async () => [group],
        getProfileById: async () => group,
        getAllSubscriptions: async () => [node],
        getSubscriptionsByIds: async () => [node],
    };
    createAdapter.mockReturnValue(adapter);
    return { store, config, group };
}
async function fetchOutput(target, query = '') {
    const pending = [];
    const response = await handleMisubRequest({
        request: new Request(`https://misub.example/profiles/group?target=${target}${query}`, {
            headers: { 'User-Agent': 'mihomo/1.19.2' },
        }),
        env: {},
        waitUntil: (promise) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(response.status).toBe(200);
    return { response, content: await response.text() };
}
beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('three modes and flag position', () => {
    it.each([
        ['auto', 'prefix', '🇺🇸 🏁 US-01'],
        ['auto', 'suffix', '🏁 US-01 🇺🇸'],
        ['preserve', 'suffix', '🏁 🌍 US-01'],
        ['remove', 'suffix', '🏁 US-01'],
    ])('%s / %s agrees in preview and cached subscriptions', async (mode, position, expected) => {
        setup({ settings: { flagEmojiMode: mode, flagEmojiPosition: position } });
        const preview = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'group',
            'mihomo/1.19.2',
            true
        );
        expect(preview.nodes[0].name).toBe(expected);
        for (const refresh of ['&refresh=1', '']) {
            const { content, response } = await fetchOutput('clash', refresh);
            expect(response.headers.get('X-Cache-Status')).toBe(refresh ? 'MISS' : 'HIT');
            expect(yaml.load(content).proxies[0].name).toBe(expected);
        }
    });

    it('profile inheritance overrides old local boolean and keeps global suffix', () => {
        const policy = resolveNodeFlagPolicy(
            {
                flagEmojiMode: 'inherit',
                flagEmojiPosition: 'inherit',
                nodeTransform: { addFlagEmoji: false },
            },
            { flagEmojiMode: 'auto', flagEmojiPosition: 'suffix' }
        );
        expect(policy).toMatchObject({ mode: 'auto', position: 'suffix' });
    });
    it('global explicit mode supersedes legacy default transformation', () => {
        expect(
            resolveNodeFlagPolicy(
                {},
                { flagEmojiMode: 'preserve', defaultNodeTransform: { addFlagEmoji: false } }
            ).mode
        ).toBe('preserve');
    });
    it('inherits the effective legacy global flag switch in preview and subscription output', async () => {
        setup({
            settings: { enableFlagEmoji: true, defaultNodeTransform: { addFlagEmoji: false } },
            profile: { flagEmojiMode: 'inherit' },
        });
        const preview = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'group',
            'mihomo',
            true
        );
        expect(preview.nodes[0].name).toBe('🏁 US-01');
        expect(yaml.load((await fetchOutput('clash')).content).proxies[0].name).toBe('🏁 US-01');
    });
    it.each([false, true])(
        'honors the already resolved legacy addFlagEmoji=%s service setting',
        async (enabled) => {
            const output = await subscriptionService.generateCombinedNodeList(
                {},
                {
                    enableFlagEmoji: !enabled,
                    enableAccessLog: false,
                    defaultNodeTransform: {
                        enabled: true,
                        rename: { template: { enabled: true, template: '{region}-{index}' } },
                    },
                },
                'MiSub-Backend',
                [{ enabled: true, url: uri('⚡ US-01') }],
                '',
                { enableManualNodes: false, nodeTransform: {}, addFlagEmoji: enabled }
            );
            expect(decodeURIComponent(output.trim().split('#')[1])).toBe(
                enabled ? '🇺🇸 ⚡ US-01' : '⚡ US-01'
            );
        }
    );
    it('preserve keeps the exact upstream country flag', async () => {
        setup({ name: '🇹🇼 Premium-01', settings: { flagEmojiMode: 'preserve' } });
        expect(yaml.load((await fetchOutput('clash')).content).proxies[0].name).toBe(
            '🇹🇼 Premium-01'
        );
    });
    it('URL mode and position override profile choices', async () => {
        setup({ profile: { flagEmojiMode: 'remove', flagEmojiPosition: 'prefix' } });
        expect(
            yaml.load(
                (await fetchOutput('clash', '&emoji-mode=auto&emoji-position=suffix')).content
            ).proxies[0].name
        ).toBe('🏁 US-01 🇺🇸');
    });
    it('keeps third-party conversion from adding another flag when a new mode is configured', async () => {
        setup({
            settings: {
                flagEmojiMode: 'preserve',
                subconverter: { engineMode: 'external', defaultBackend: 'https://convert.example' },
            },
        });
        const response = await handleMisubRequest({
            request: new Request('https://misub.example/profiles/group?target=clash', {
                headers: { 'User-Agent': 'mihomo/1.19.2' },
            }),
            env: {},
            waitUntil: () => {},
        });
        expect(response.status).toBe(302);
        expect(new URL(response.headers.get('location')).searchParams.get('emoji')).toBe('false');
    });
    it.each(['clash', 'surge', 'loon', 'quanx', 'singbox', 'egern', 'nodes', 'base64'])(
        'keeps suffix placement in %s',
        async (target) => {
            setup({
                name: '⚡ US-01',
                settings: { flagEmojiMode: 'auto', flagEmojiPosition: 'suffix' },
            });
            let { content } = await fetchOutput(target);
            if (target === 'base64') content = Buffer.from(content, 'base64').toString('utf8');
            if (target === 'nodes' || target === 'base64') content = decodeURIComponent(content);
            expect(content).toContain('⚡ US-01 🇺🇸');
            expect(content).not.toContain('🇺🇸 ⚡ US-01');
        }
    );
});

describe('country-only cleanup and fallback', () => {
    it.each(['⚡', '🚀', '🏁', '🏳️‍🌈', '🏳️‍⚧️', '🚩', '🌎', '🌏', '🌐'])(
        'keeps %s while adding or removing national flags',
        (emoji) => {
            const added = addFlagEmoji(uri(`${emoji} US-01`));
            expect(decodeURIComponent(added.split('#')[1])).toBe(`🇺🇸 ${emoji} US-01`);
            expect(decodeURIComponent(removeFlagEmoji(added).split('#')[1])).toBe(`${emoji} US-01`);
        }
    );
    it('uses only the globe fallback for an unrecognizable node', () => {
        expect(decodeURIComponent(addFlagEmoji(uri('🚀 CustomNode')).split('#')[1])).toBe(
            '🌍 🚀 CustomNode'
        );
        expect(addFlagEmoji(addFlagEmoji(uri('🚀 CustomNode')))).toBe(
            addFlagEmoji(uri('🚀 CustomNode'))
        );
    });
    it('never interprets credentials as a country name for unnamed nodes', () => {
        const output = addFlagEmoji('trojan://US@example.com:443');
        expect(decodeURIComponent(output.split('#')[1])).toBe('🌍 example.com');
    });
    it('does not interpret IPv6 segments as country codes', () => {
        expect(identifyNodeRegion('2001:be01::1').region).toBe('其他');
    });
    it('uses the original country rather than an airport-brand flag prefix', async () => {
        setup({
            name: '🇺🇸 US-01',
            settings: {
                defaultPrefixSettings: { enableManualNodes: true, manualNodePrefix: '🇭🇰 Airport' },
            },
        });
        expect(yaml.load((await fetchOutput('clash')).content).proxies[0].name).toBe(
            '🇺🇸 Airport - US-01'
        );
    });
});

describe('rule scope and explicit templates', () => {
    it.each([
        ['inherit', '🇯🇵'],
        ['extend', '🇩🇪'],
        ['replace', '🇩🇪'],
    ])('applies profile rule mode %s to preview, flags and builtin groups', async (mode, flag) => {
        const { group } = setup({
            name: 'US-01',
            settings: { regionOverrides: [{ pattern: 'US', region: 'JP', scope: 'all' }] },
            profile: {
                regionOverrideMode: mode,
                regionOverrides: [{ pattern: 'US', region: 'DE', scope: 'all' }],
            },
        });
        const preview = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'group',
            'mihomo',
            true
        );
        expect(preview.nodes[0].name).toBe(`${flag} US-01`);
        const config = yaml.load((await fetchOutput('clash')).content);
        expect(config.proxies[0].name).toBe(`${flag} US-01`);
        expect(
            config['proxy-groups'].some((item) =>
                item.name.includes(mode === 'inherit' ? '日本节点' : '德国节点')
            )
        ).toBe(true);
        if (mode !== 'inherit') {
            group.regionOverrides[0].region = 'FR';
            const changed = await fetchOutput('clash');
            expect(changed.response.headers.get('X-Cache-Status')).toBe('MISS');
            expect(yaml.load(changed.content).proxies[0].name).toBe('🇫🇷 US-01');
        }
    });
    const template = (value) => [
        { type: 'rename', params: { template: { enabled: true, template: value } } },
    ];
    it('keeps country hints in per-source protective caches after a generic rename', async () => {
        const saved = new Map();
        const storage = {
            get: async (key) => saved.get(key),
            put: async (key, value) => saved.set(key, value),
        };
        const sub = {
            id: 'source',
            enabled: true,
            enableNodeCache: true,
            url: 'https://source.example/sub',
            operators: [
                {
                    type: 'rename',
                    params: {
                        regex: {
                            enabled: true,
                            rules: [{ pattern: 'US-01', replacement: 'Premium' }],
                        },
                    },
                },
            ],
        };
        const config = { enableAccessLog: false };
        const options = { enableManualNodes: false, enableSubscriptions: false };
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(uri('US-01')))
        );
        const first = await subscriptionService.generateCombinedNodeList(
            { storage },
            config,
            'MiSub-Backend',
            [sub],
            '',
            options
        );
        expect(decodeURIComponent(first)).toContain('🇺🇸 Premium');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('', { status: 404 }))
        );
        const second = await subscriptionService.generateCombinedNodeList(
            { storage },
            config,
            'MiSub-Backend',
            [sub],
            '',
            options
        );
        expect(second).toBe(first);
        const { fetchSubscriptionNodes } =
            await import('../../functions/modules/subscription/node-fetcher.js');
        const regionResolver = createRegionResolver();
        const preview = await fetchSubscriptionNodes(
            sub.url,
            'source',
            'mihomo',
            null,
            false,
            '',
            null,
            false,
            false,
            true,
            false,
            storage,
            sub,
            regionResolver
        );
        expect(preview.fromCache).toBe(true);
        expect(regionResolver.hint(preview.nodes[0].url).code).toBe('US');
        const changed = await subscriptionService.generateCombinedNodeList(
            { storage },
            { ...config, regionOverrides: [{ pattern: 'US', region: 'JP', scope: 'all' }] },
            'MiSub-Backend',
            [sub],
            '',
            options
        );
        expect(changed).toBe('');
    });
    it.each([
        ['group', '🇺🇸 Premium'],
        ['all', '🇯🇵 Premium'],
    ])(
        'reevaluates %s-scope rules that match a name created by an operator',
        async (scope, expected) => {
            setup({
                name: 'US-01',
                settings: {
                    regionOverrides: [{ pattern: '^Premium$', region: 'JP', scope }],
                    defaultOperators: [
                        {
                            type: 'rename',
                            params: {
                                regex: {
                                    enabled: true,
                                    rules: [{ pattern: 'US-01', replacement: 'Premium' }],
                                },
                            },
                        },
                    ],
                },
            });
            const preview = await handleProfileMode(
                new Request('https://misub.example/api/subscription_nodes'),
                {},
                'group',
                'mihomo',
                true
            );
            expect(preview.nodes[0].name).toBe(expected);
            const config = yaml.load((await fetchOutput('clash')).content);
            expect(config.proxies[0].name).toBe(expected);
            expect(config['proxy-groups'].some((group) => group.name.includes('日本节点'))).toBe(
                true
            );
        }
    );
    it('group-only overrides preserve the node flag and naming variables', async () => {
        setup({
            name: '新加坡 原生',
            settings: {
                regionOverrides: [{ pattern: '新加坡', region: 'US', scope: 'group' }],
                defaultOperators: template('{emoji}{region}-{index}'),
            },
        });
        const config = yaml.load((await fetchOutput('clash')).content);
        expect(config.proxies[0].name).toBe('🇸🇬新加坡-1');
        expect(config['proxy-groups'].some((group) => group.name.includes('美国节点'))).toBe(true);
    });
    it('all-scope overrides update flag, variable and groups across cache hits', async () => {
        setup({
            name: '新加坡 原生',
            settings: {
                flagEmojiPosition: 'suffix',
                regionOverrides: [{ pattern: '新加坡', region: 'US', scope: 'all' }],
                defaultOperators: template('{emoji}{region}-{index}'),
            },
        });
        for (const refresh of ['&refresh=1', '']) {
            const config = yaml.load((await fetchOutput('clash', refresh)).content);
            expect(config.proxies[0].name).toBe('🇺🇸美国-1');
            expect(config['proxy-groups'].some((group) => group.name.includes('美国节点'))).toBe(
                true
            );
        }
    });
    it('templates control position and do not duplicate existing flags', async () => {
        setup({
            name: '🇺🇸 ⚡ US-01',
            settings: {
                flagEmojiPosition: 'prefix',
                defaultOperators: template('{name} / {emoji} / {countryCode}'),
            },
        });
        expect(yaml.load((await fetchOutput('clash')).content).proxies[0].name).toBe(
            '⚡ US-01 / 🇺🇸 / US'
        );
    });
    it('preserve still runs an explicitly configured naming template', async () => {
        setup({
            name: '⚡ US-01',
            settings: { flagEmojiMode: 'preserve', defaultOperators: template('{emoji}{name}') },
        });
        expect(yaml.load((await fetchOutput('clash')).content).proxies[0].name).toBe('🇺🇸⚡ US-01');
    });
    it('keeps flag-only Taiwanese identity through emoji-only templates and caches', async () => {
        setup({ name: '🇹🇼 Premium', settings: { defaultOperators: template('{emoji}{name}') } });
        for (const refresh of ['&refresh=1', '']) {
            const config = yaml.load((await fetchOutput('clash', refresh)).content);
            expect(config.proxies[0].name).toBe('🇨🇳Premium');
            expect(config['proxy-groups'].some((group) => group.name.includes('台湾节点'))).toBe(
                true
            );
        }
    });
    it('keeps foreground country hints isolated from a stale-cache background refresh', async () => {
        const { store } = setup({
            name: '🇹🇼 Premium',
            settings: { defaultOperators: template('{emoji}{name}') },
        });
        await fetchOutput('clash');
        store.get('node_cache_profile_group').timestamp = Date.now() - 4 * 60 * 1000;
        const generate = subscriptionService.generateCombinedNodeList;
        const refreshSpy = vi
            .spyOn(subscriptionService, 'generateCombinedNodeList')
            .mockImplementation(async (context, ...args) => {
                for (let index = 0; index <= 20000; index++)
                    context.regionResolver.remember(`new-${index}`, { region: '美国' });
                return generate(context, ...args);
            });
        const { content, response } = await fetchOutput('clash');
        expect(refreshSpy).toHaveBeenCalledOnce();
        expect(response.headers.get('X-Cache-Status')).toBe('REFRESHING');
        expect(
            yaml.load(content)['proxy-groups'].some((group) => group.name.includes('台湾节点'))
        ).toBe(true);
    });
    it('restores country hints when a suspicious forced refresh falls back to preserved cache', async () => {
        const { store } = setup({
            name: '🇹🇼 Premium',
            settings: { defaultOperators: template('{emoji}{name}') },
        });
        await fetchOutput('clash');
        const entry = store.get('node_cache_profile_group');
        const info = entry.regionHints[0];
        entry.nodes =
            Array.from({ length: 30 }, (_, index) => uri(`🇨🇳Premium-${index}`)).join('\n') + '\n';
        entry.nodeCount = 30;
        entry.regionHints = Object.fromEntries(
            Array.from({ length: 30 }, (_, index) => [index, info])
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const config = yaml.load((await fetchOutput('clash', '&refresh=1')).content);
        expect(config.proxies).toHaveLength(30);
        expect(config['proxy-groups'].some((group) => group.name.includes('台湾节点'))).toBe(true);
    });
});

describe('country registry and bounded request caches', () => {
    it('identifies every registered country flag and bundles its SVG locally', () => {
        for (const country of COUNTRY_REGISTRY) {
            const flag = [...country.code]
                .map((letter) => String.fromCodePoint(letter.charCodeAt(0) - 65 + 0x1f1e6))
                .join('');
            expect(identifyNodeRegion(`${flag} Premium`).code, country.code).toBe(country.code);
            expect(
                fs.existsSync(`public/flags/${country.code.toLowerCase()}.svg`),
                country.code
            ).toBe(true);
        }
    });
    it.each([
        ['My Node', ''],
        ['Connect to US', 'US'],
        ['North Korea', 'KP'],
        ['South-Korea', 'KR'],
        ['Guinea-Bissau', 'GW'],
        ['🇧🇱 Premium', 'BL'],
        ['🇿🇿 Unknown', ''],
        ['SS Node', ''],
        ['VMESS 节点', ''],
        ['WS Node', ''],
        ['CF Proxy', ''],
        ['AI Node', ''],
        ['SS US-01', 'US'],
        ['🇸🇸 SS Node', 'SS'],
        ['🏁 上海-01', 'CN'],
    ])('identifies %s accurately', (name, code) =>
        expect(identifyNodeRegion(name).code).toBe(code)
    );
    it('uses an isolated bounded cache and reuses repeated name lookups', () => {
        const cache = createRegionResolver([], { capacity: 20 });
        cache.resolve('US-01');
        cache.resolve('US-01');
        expect(cache.stats).toEqual({ hits: 1, misses: 1 });
        const other = createRegionResolver();
        other.resolve('US-01');
        expect(other.stats.hits).toBe(0);
        for (let index = 0; index < 100; index++) cache.resolve(`US-${index}`);
        const misses = cache.stats.misses;
        cache.resolve('US-0');
        expect(cache.stats.misses).toBe(misses + 1);
    });
});
