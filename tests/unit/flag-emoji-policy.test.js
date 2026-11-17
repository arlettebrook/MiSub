// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlsToClashProxies } from '../../functions/utils/url-to-clash.js';
import { resolveEffectiveNodeTransform } from '../../functions/utils/node-transform-settings.js';

const createAdapter = vi.fn();
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: async () => 'kv',
        resolveKV: (env) => env?.MISUB_KV || null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));

const NODE_NAME = 'US-A100-01';
const FLAGGED_NAME = `🇺🇸 ${NODE_NAME}`;
const legacyTemplate = (template) => ({
    enabled: true,
    rename: { template: { enabled: true, template } },
});
const workflowTemplate = (template, enabled = true) => ({
    type: 'rename',
    enabled,
    params: { template: { enabled: true, template } },
});

function configure({ settings = {}, profile = {}, name = NODE_NAME, url } = {}) {
    const node = {
        id: 'node-a',
        enabled: true,
        name,
        url: url || `trojan://pass@example.com:443#${encodeURIComponent(name)}`,
    };
    const savedProfile = {
        id: 'group-a',
        name: 'Flag Test',
        enabled: true,
        transformConfigMode: 'global',
        subscriptions: [],
        manualNodes: [node.id],
        ...profile,
    };
    const savedSettings = {
        mytoken: 'flag-test-token',
        profileToken: 'profiles',
        enableFlagEmoji: true,
        enableAccessLog: false,
        enableTrafficNode: false,
        defaultPrefixSettings: { enableManualNodes: false, enableSubscriptions: false },
        ...settings,
    };
    const store = new Map([['worker_settings_v1', savedSettings]]);
    const adapter = {
        store,
        settings: savedSettings,
        get: async (key) => store.get(key) ?? null,
        put: async (key, value) => {
            store.set(key, value);
            return true;
        },
        getAllSubscriptions: async () => [node],
        getAllProfiles: async () => [savedProfile],
        getProfileById: async () => savedProfile,
        getSubscriptionsByIds: async (ids) => (ids.includes(node.id) ? [node] : []),
    };
    createAdapter.mockReturnValue(adapter);
    return adapter;
}

async function request(target = 'clash', query = '', direct = false) {
    const pending = [];
    const response = await handleMisubRequest({
        request: new Request(
            `https://misub.example/${direct ? 'flag-test-token' : 'profiles/group-a'}?target=${target}${query}`,
            {
                headers: { 'User-Agent': 'mihomo/1.19.2' },
            }
        ),
        env: {},
        waitUntil: (promise) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(response.status).toBe(200);
    return { response, content: await response.text() };
}

async function preview(query = '', applyTransform = true) {
    const result = await handleProfileMode(
        new Request(`https://misub.example/api/subscription_nodes?${query.replace(/^&/, '')}`),
        {},
        'group-a',
        'mihomo/1.19.2',
        applyTransform
    );
    expect(result.success).toBe(true);
    return result.nodes;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('preview and actual subscription flag policy', () => {
    it.each([
        ['default', {}, {}, '', NODE_NAME, FLAGGED_NAME],
        [
            'global off strips upstream flag',
            { enableFlagEmoji: false },
            {},
            '',
            FLAGGED_NAME,
            NODE_NAME,
        ],
        [
            'profile off',
            {},
            { nodeTransform: { addFlagEmoji: false } },
            '',
            FLAGGED_NAME,
            NODE_NAME,
        ],
        [
            'profile on overrides global',
            { enableFlagEmoji: false },
            { nodeTransform: { enabled: false, addFlagEmoji: true } },
            '',
            NODE_NAME,
            FLAGGED_NAME,
        ],
        [
            'global transform flag',
            { defaultNodeTransform: { addFlagEmoji: false } },
            {},
            '',
            FLAGGED_NAME,
            NODE_NAME,
        ],
        [
            'preset off',
            { nodeTransformPresets: [{ id: 'off', config: { addFlagEmoji: false } }] },
            { nodeTransformPresetId: 'off' },
            '',
            FLAGGED_NAME,
            NODE_NAME,
        ],
        [
            'preset naming template',
            {
                nodeTransformPresets: [
                    { id: 'rename', config: legacyTemplate('{region}-{index}') },
                ],
            },
            { nodeTransformPresetId: 'rename' },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'profile overrides selected preset',
            { nodeTransformPresets: [{ id: 'off', config: { addFlagEmoji: false } }] },
            { nodeTransformPresetId: 'off', nodeTransform: { addFlagEmoji: true } },
            '',
            NODE_NAME,
            FLAGGED_NAME,
        ],
        [
            'empty preset does not reapply global transformation',
            {
                defaultNodeTransform: legacyTemplate('{region}-{index}'),
                nodeTransformPresets: [{ id: 'empty', config: {} }],
            },
            { nodeTransformPresetId: 'empty' },
            '',
            NODE_NAME,
            FLAGGED_NAME,
        ],
        [
            'URL off overrides profile',
            {},
            { nodeTransform: { addFlagEmoji: true } },
            '&emoji=false',
            FLAGGED_NAME,
            NODE_NAME,
        ],
        [
            'URL on overrides global',
            { enableFlagEmoji: false },
            {},
            '&emoji=true',
            NODE_NAME,
            FLAGGED_NAME,
        ],
        [
            'global naming template',
            { defaultNodeTransform: legacyTemplate('{region}-{index}') },
            {},
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'profile naming template',
            {},
            { nodeTransform: legacyTemplate('{region}-{index}') },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'URL on respects template without emoji',
            {},
            { nodeTransform: legacyTemplate('{region}-{index}') },
            '&emoji=true',
            NODE_NAME,
            '美国-1',
        ],
        [
            'legacy emoji template cannot bypass off',
            { enableFlagEmoji: false },
            { nodeTransform: legacyTemplate('{emoji}{region}-{index}') },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'workflow emoji template cannot bypass off',
            { enableFlagEmoji: false },
            { operators: [workflowTemplate('{emoji}{region}-{index}')] },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'workflow without emoji',
            {},
            { operators: [workflowTemplate('{region}-{index}')] },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'global workflow without emoji',
            { defaultOperators: [workflowTemplate('{region}-{index}')] },
            {},
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'explicit workflow supersedes legacy template',
            {},
            {
                nodeTransform: legacyTemplate('{region}-{index}'),
                operators: [workflowTemplate('{emoji}{region}-{index}')],
            },
            '',
            NODE_NAME,
            '🇺🇸美国-1',
        ],
        [
            'last workflow template controls flag output',
            {},
            {
                operators: [
                    workflowTemplate('{emoji}{region}-{index}'),
                    workflowTemplate('{region}-{index}'),
                ],
            },
            '',
            NODE_NAME,
            '美国-1',
        ],
        [
            'disabled template does not suppress flag',
            {},
            { operators: [workflowTemplate('{region}-{index}', false)] },
            '',
            NODE_NAME,
            FLAGGED_NAME,
        ],
        [
            'disabled profile overrides global transform',
            { defaultNodeTransform: legacyTemplate('{region}-{index}') },
            { nodeTransform: { enabled: false } },
            '',
            NODE_NAME,
            FLAGGED_NAME,
        ],
    ])('%s', async (_label, settings, profile, query, name, expected) => {
        configure({ settings, profile, name });
        const previewNodes = await preview(query);
        expect(previewNodes.map((node) => node.name)).toEqual([expected]);
        for (const refresh of ['&refresh=1', '']) {
            const { response, content } = await request('clash', query + refresh);
            expect(response.headers.get('X-Cache-Status')).toBe(refresh ? 'MISS' : 'HIT');
            expect(yaml.load(content).proxies.map((node) => node.name)).toEqual([expected]);
        }
    });

    it('keeps raw preview untouched when transformations are disabled', async () => {
        configure({ settings: { enableFlagEmoji: false }, name: FLAGGED_NAME });
        expect((await preview('', false))[0].name).toBe(FLAGGED_NAME);
    });

    it('invalidates processed cache when the effective global flag policy changes', async () => {
        const adapter = configure();
        expect(yaml.load((await request()).content).proxies[0].name).toBe(FLAGGED_NAME);
        adapter.settings.enableFlagEmoji = false;
        const { response, content } = await request();
        expect(response.headers.get('X-Cache-Status')).toBe('MISS');
        expect(yaml.load(content).proxies[0].name).toBe(NODE_NAME);
    });

    it('resolves empty profiles, missing presets and URL overrides without mutating configuration', () => {
        const config = { defaultNodeTransform: { enabled: true, addFlagEmoji: false } };
        const profile = { nodeTransform: {}, nodeTransformPresetId: 'missing' };
        expect(resolveEffectiveNodeTransform(profile, config)).toEqual(config.defaultNodeTransform);
        expect(
            resolveEffectiveNodeTransform(profile, config, new URLSearchParams('emoji=true'))
                .addFlagEmoji
        ).toBe(true);
        expect(config.defaultNodeTransform.addFlagEmoji).toBe(false);
    });
});

describe('actual output entry points', () => {
    it.each(['clash', 'singbox', 'egern', 'surge', 'loon', 'quanx', 'base64', 'nodes'])(
        'disables node flags for direct token target=%s',
        async (target) => {
            configure({ settings: { enableFlagEmoji: false }, name: FLAGGED_NAME });
            const { content } = await request(target, '&refresh=1', true);
            let names;
            if (target === 'clash') names = yaml.load(content).proxies.map((proxy) => proxy.name);
            else if (target === 'egern')
                names = yaml.load(content).proxies.map((proxy) => proxy.trojan.name);
            else if (target === 'singbox')
                names = JSON.parse(content)
                    .outbounds.filter((proxy) => proxy.type === 'trojan')
                    .map((proxy) => proxy.tag);
            else if (target === 'base64' || target === 'nodes') {
                const nodeList =
                    target === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content;
                names = urlsToClashProxies(nodeList.trim().split('\n'), {
                    addFlagEmoji: false,
                }).map((proxy) => proxy.name);
            } else {
                names = [
                    content
                        .split(target === 'quanx' ? '[server_local]' : '[Proxy]')[1]
                        .split('\n[')[0],
                ];
            }
            expect(names).toHaveLength(1);
            expect(names[0]).toContain(NODE_NAME);
            expect(names[0]).not.toMatch(/🇺🇸|🌍/u);
        }
    );

    it.each([
        ['global off', { enableFlagEmoji: false }, {}, ''],
        ['URL off', {}, {}, '&emoji=false'],
        ['template without emoji', {}, { nodeTransform: legacyTemplate('{region}-{index}') }, ''],
    ])(
        'passes %s to external-engine local YAML rendering',
        async (_label, settings, profile, query) => {
            configure({
                settings: {
                    ...settings,
                    subconverter: { engineMode: 'external' },
                    transformConfigMode: 'remote',
                    transformConfig: 'https://templates.example/flag-test.yaml',
                },
                profile,
            });
            vi.stubGlobal(
                'fetch',
                vi.fn(
                    async () =>
                        new Response(
                            'proxy-groups:\n  - name: Select\n    type: select\n    proxies: [DIRECT]\nrules: [MATCH,Select]\n'
                        )
                )
            );
            const { response, content } = await request('clash', '&refresh=1' + query);
            expect(response.headers.get('X-MiSub-Template-Mode')).toBe('clash-yaml-profile');
            expect(yaml.load(content).proxies[0].name).not.toMatch(/🇺🇸|🌍/u);
        }
    );
});

describe('post-transform cleanup', () => {
    it.each(['🇺🇸 US-01', '🌍 CustomNode'])(
        'removes existing flag symbols from %s',
        async (name) => {
            const list = await generateCombinedNodeList(
                {},
                { enableFlagEmoji: false },
                'ClashMeta',
                [
                    {
                        enabled: true,
                        url: `trojan://pass@example.com:443#${encodeURIComponent(name)}`,
                    },
                ],
                '',
                { enableManualNodes: false }
            );
            expect(
                urlsToClashProxies(list.trim().split('\n'), { addFlagEmoji: false })[0].name
            ).toBe(name.replace(/🇺🇸|🌍/u, '').trim());
        }
    );

    it('strips emoji emitted by an unknown-region naming template', async () => {
        configure({
            name: 'CustomNode',
            settings: { enableFlagEmoji: false },
            profile: { nodeTransform: legacyTemplate('{emoji}{name}') },
        });
        expect((await preview())[0].name).toBe('CustomNode');
        expect(yaml.load((await request()).content).proxies[0].name).toBe('CustomNode');
    });

    it('keeps SSR credentials parseable while stripping existing flags', async () => {
        const url = convertClashProxyToUrl({
            name: '🇺🇸 US-SSR-01',
            type: 'ssr',
            server: 'example.com',
            port: 12345,
            protocol: 'auth_aes128_sha1',
            cipher: 'chacha20-ietf',
            obfs: 'plain',
            password: 'password',
        });
        const list = await generateCombinedNodeList(
            {},
            { enableFlagEmoji: false },
            'ClashMeta',
            [{ enabled: true, url }],
            '',
            { enableManualNodes: false }
        );
        expect(
            urlsToClashProxies(list.trim().split('\n'), { addFlagEmoji: false })[0]
        ).toMatchObject({
            name: 'US-SSR-01',
            type: 'ssr',
            server: 'example.com',
            password: 'password',
        });
    });
});
