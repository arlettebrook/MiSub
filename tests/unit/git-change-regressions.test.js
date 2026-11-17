// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { previewNodeProcessing, processNodeUrls } from '../../functions/utils/node-processing.js';
import { createRegionResolver } from '../../shared/node-region-context.js';
import { urlsToClashProxies } from '../../functions/utils/url-to-clash.js';
import { groupNodeLinesByRegion } from '../../functions/modules/subscription/region-groups.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { generateBuiltinSingboxConfig } from '../../functions/modules/subscription/builtin-singbox-generator.js';
import { handleMisubRequest } from '../../functions/modules/subscription/main-handler.js';

const createAdapter = vi.hoisted(() => vi.fn());
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: async () => 'kv',
        resolveKV: () => null,
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' },
}));

const uri = (name) => `trojan://pass@relay.example:443#${encodeURIComponent(name)}`;

describe('Git change compatibility regressions', () => {
    it.each([{}, [null]])(
        'ignores malformed historical preset entries (%j)',
        async (nodeTransformPresets) => {
            const result = await previewNodeProcessing(
                'US-01',
                { nodeTransformPresetId: 'legacy' },
                { nodeTransformPresets }
            );
            expect(result.rows[0].newName).toBe('🇺🇸 US-01');
        }
    );
    it('executes legacy rename templates through the restricted DSL', async () => {
        const result = await previewNodeProcessing('US-01', {
            nodeTransform: {
                enabled: true,
                rename: { script: { enabled: true, expression: 'Renamed {name}' } },
            },
            flagEmojiMode: 'preserve',
        });
        expect(result.rows[0].newName).toBe('Renamed US-01');
    });

    it.each(['{emoji:UPPER}{name}', '{emoji:lower}{name}', '{emoji:Title}{name}'])(
        'recognizes the emoji placeholder in %s',
        async (template) => {
            const result = await previewNodeProcessing('🇺🇸 US-01', null, {
                defaultOperators: [
                    { type: 'rename', params: { template: { enabled: true, template } } },
                ],
            });
            expect(result.rows[0].newName).toBe('🇺🇸US-01');
        }
    );

    it.each([false, true])(
        'retains output country identity through cache and conversion (operators=%s)',
        async (withOperators) => {
            const source = [uri('🇺🇸 Premium'), uri('🇯🇵 Premium')];
            const regionResolver = createRegionResolver();
            const flagPolicy = { mode: 'remove', position: 'prefix' };
            const operators = withOperators
                ? [{ type: 'rename', params: { template: { enabled: true, template: 'Premium' } } }]
                : [];
            const { urls } = await processNodeUrls(source, {
                regionResolver,
                flagPolicy,
                operators,
            });
            expect(urls).toHaveLength(2);
            const check = (resolver) => {
                const proxies = urlsToClashProxies(urls, { regionResolver: resolver, flagPolicy });
                expect(proxies.map((p) => p.metadata.region)).toEqual(['美国', '日本']);
                expect(
                    groupNodeLinesByRegion(proxies).map((group) => [group.name, group.count])
                ).toEqual([
                    ['🇺🇸 美国节点', 1],
                    ['🇯🇵 日本节点', 1],
                ]);
            };
            check(regionResolver);
            const cached = regionResolver.exportHints(urls);
            expect(Object.values(cached).map((info) => info.code)).toEqual(['US', 'JP']);
            const restored = createRegionResolver();
            restored.importHints(urls.join('\n'), cached);
            check(restored);
        }
    );

    it('keeps distinct countries in generated subscription output after flag removal', async () => {
        const regionResolver = createRegionResolver();
        const sources = ['🇺🇸 Premium', '🇯🇵 Premium'].map((name, index) => ({
            id: `manual-${index}`,
            name,
            url: uri(name),
            enabled: true,
        }));
        const flagPolicy = { mode: 'remove', position: 'prefix' };
        const list = await generateCombinedNodeList(
            { regionResolver },
            { enableAccessLog: false },
            'mihomo',
            sources,
            '',
            { enableManualNodes: false, enableSubscriptions: false, flagPolicy }
        );
        const proxies = urlsToClashProxies(list.trim().split('\n'), { regionResolver, flagPolicy });
        expect(proxies.map((p) => p.metadata.region)).toEqual(['美国', '日本']);
    });

    it('keeps group-only country overrides in Sing-box after renaming', async () => {
        const regionResolver = createRegionResolver([
            { pattern: 'US', region: 'JP', scope: 'group' },
        ]);
        const flagPolicy = { mode: 'remove', position: 'prefix' };
        const { urls } = await processNodeUrls([uri('US-01')], {
            regionResolver,
            flagPolicy,
            operators: [
                { type: 'rename', params: { template: { enabled: true, template: 'Premium' } } },
            ],
        });
        const config = JSON.parse(
            generateBuiltinSingboxConfig(urls.join('\n'), { regionResolver, flagPolicy })
        );
        const group = config.outbounds.find((node) => node.tag === '🇯🇵 日本节点');
        expect(group?.outbounds).toContain('Premium');
        expect(config.outbounds.every((node) => !Object.hasOwn(node, 'metadata'))).toBe(true);
    });

    it('keeps country memberships through real request generation and aggregate cache hits', async () => {
        const nodes = ['🇺🇸 Premium', '🇯🇵 Premium'].map((name, index) => ({
            id: `node-${index}`,
            name,
            url: uri(name),
            enabled: true,
        }));
        const profile = {
            id: 'group',
            name: 'Test',
            enabled: true,
            subscriptions: [],
            manualNodes: nodes.map((node) => node.id),
            flagEmojiMode: 'remove',
        };
        const config = {
            mytoken: 'token',
            profileToken: 'profiles',
            enableAccessLog: false,
            enableTrafficNode: false,
            defaultPrefixSettings: { enableManualNodes: false, enableSubscriptions: false },
        };
        const store = new Map([['worker_settings_v1', config]]);
        createAdapter.mockReturnValue({
            get: async (key) => store.get(key) || null,
            put: async (key, value) => {
                store.set(key, value);
                return true;
            },
            getAllProfiles: async () => [profile],
            getProfileById: async () => profile,
            getAllSubscriptions: async () => nodes,
            getSubscriptionsByIds: async () => nodes,
        });
        for (const target of ['clash', 'singbox', 'clash']) {
            const pending = [];
            const response = await handleMisubRequest({
                request: new Request(`https://misub.example/profiles/group?target=${target}`, {
                    headers: { 'User-Agent': 'mihomo/1.19.2' },
                }),
                env: {},
                waitUntil: (promise) => pending.push(promise),
            });
            await Promise.all(pending);
            expect(response.status).toBe(200);
            const output = await response.text();
            if (target === 'clash') {
                const data = yaml.load(output);
                expect(
                    data['proxy-groups'].find((group) => group.name === '🇺🇸 美国节点')?.proxies
                ).toContain(data.proxies[0].name);
                expect(
                    data['proxy-groups'].find((group) => group.name === '🇯🇵 日本节点')?.proxies
                ).toContain(data.proxies[1].name);
            } else {
                const data = JSON.parse(output);
                const proxies = data.outbounds.filter((node) => node.type === 'trojan');
                expect(
                    data.outbounds.find((node) => node.tag === '🇺🇸 美国节点')?.outbounds
                ).toContain(proxies[0].tag);
                expect(
                    data.outbounds.find((node) => node.tag === '🇯🇵 日本节点')?.outbounds
                ).toContain(proxies[1].tag);
            }
        }
    });
});
