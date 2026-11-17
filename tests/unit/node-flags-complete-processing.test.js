// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { identifyNodeRegion } from '../../shared/node-regions.js';
import { createRegionResolver, resolveRegionOverrides } from '../../shared/node-region-context.js';
import { NODE_PROCESSING_VERSION } from '../../shared/node-processing-version.js';
import { previewNodeProcessing } from '../../functions/utils/node-processing.js';
import {
    generateCombinedNodeList,
    readSubscriptionNodeCache,
    buildSubscriptionNodeCacheKey,
} from '../../functions/services/subscription-service.js';
import { getCache, setCache } from '../../functions/services/node-cache-service.js';
import { resolveNodeListWithCache } from '../../functions/modules/subscription/cache-manager.js';
const uri = (name, server = 'sample.example') =>
    `trojan://pass@${server}:443#${encodeURIComponent(name)}`;

describe('region conflict diagnostics', () => {
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    it('recognizes regional tag flags even after another emoji', () => {
        expect(identifyNodeRegion(`🏁 ${england} Premium`).code).toBe('GB');
    });
    it('includes regional tag flags in multiple-flag conflict diagnostics', () => {
        expect(identifyNodeRegion(`${england} 🇯🇵 Premium`)).toMatchObject({
            flag: '🌍',
            conflict: true,
        });
    });
    it.each(['US/JP', '香港 日本', '🇺🇸 🇯🇵', '🇺🇸 香港', '香港中转日本'])(
        'uses 🌍 for unresolved %s and exposes evidence',
        (name) => {
            const info = identifyNodeRegion(name);
            expect(info).toMatchObject({
                region: '其他',
                flag: '🌍',
                source: 'conflict',
                conflict: true,
            });
            expect(info.candidates).toHaveLength(2);
            expect(info.candidates.every((item) => item.matched && item.code)).toBe(true);
        }
    );
    it.each(['香港→日本', 'HK -> JP', '🇺🇸 ➡ 🇯🇵', 'US 中转，出口: Japan'])(
        'identifies the explicit destination in %s',
        (name) => {
            expect(identifyNodeRegion(name)).toMatchObject({
                code: 'JP',
                source: 'destination',
                conflict: false,
            });
        }
    );
    it.each([
        ['North Korea', 'KP'],
        ['Guinea-Bissau', 'GW'],
        ['🇨🇳 TW-01', 'TW'],
        ['India', 'IN'],
        ['印度尼西亚', 'ID'],
    ])('does not create false conflicts for %s', (name, code) => {
        expect(identifyNodeRegion(name).code).toBe(code);
    });
    it('resolves ambiguous names with an all-scope override and preserves other emoji', async () => {
        const result = await previewNodeProcessing('⚡ US/JP', null, {
            regionOverrides: [{ pattern: 'US/JP', region: 'JP', scope: 'all' }],
        });
        expect(result.rows[0].newName).toBe('🇯🇵 ⚡ US/JP');
        expect(result.rows[0].after).toMatchObject({ source: 'override', conflict: false });
        expect(result.rows[0].after.candidates).toHaveLength(2);
    });
});

describe('shared complete processing preview', () => {
    it('shows the grouping rule pattern as evidence without changing the physical country', async () => {
        const result = await previewNodeProcessing('VIP US-01', null, {
            regionOverrides: [{ pattern: '^VIP', region: 'JP', scope: 'group' }],
        });
        expect(result.rows[0].after.code).toBe('US');
        expect(result.rows[0].reason).toMatchObject({
            region: '日本',
            source: 'override',
            matched: '^VIP',
        });
    });
    it.each([
        ['all', false],
        ['group', true],
    ])('uses %s-scope country metadata for the final region whitelist', async (scope, filtered) => {
        const result = await previewNodeProcessing('US-01', null, {
            exclude: 'keep: JP',
            regionOverrides: [{ pattern: 'US', region: 'JP', scope }],
        });
        expect(result.rows[0].filtered).toBe(filtered);
    });
    it('deduplicates identical input links once and attributes output to the first occurrence', async () => {
        const link = uri('US-01');
        const result = await previewNodeProcessing(`${link}\n${link}`, null, {});
        expect(result.outputCount).toBe(1);
        expect(result.rows.map((row) => row.filtered)).toEqual([false, true]);
    });
    it('counts overrides hit at intermediate workflow steps even if a later filter removes the node', async () => {
        const result = await previewNodeProcessing('Custom', null, {
            regionOverrides: [
                { pattern: 'StageA', region: 'JP', scope: 'all' },
                { pattern: 'StageB', region: 'DE', scope: 'all' },
            ],
            defaultOperators: [
                { type: 'rename', params: { template: { enabled: true, template: 'StageA' } } },
                { type: 'rename', params: { template: { enabled: true, template: 'StageB' } } },
                { type: 'filter', params: { exclude: { enabled: true, rules: ['StageB'] } } },
            ],
        });
        expect(result.rows[0].filtered).toBe(true);
        expect(result.rows[0].ruleHits).toEqual([0, 1]);
    });
    it('matches actual output for filters, regex, multiple templates, DSL, sorting and deduplication', async () => {
        const urls = [
            uri('US-a', 'a.example'),
            uri('JP-b', 'b.example'),
            uri('US-duplicate-long', 'a.example'),
            uri('Drop', 'c.example'),
        ];
        const operators = [
            { type: 'filter', params: { exclude: { enabled: true, rules: ['Drop'] } } },
            {
                type: 'rename',
                params: {
                    regex: { enabled: true, rules: [{ pattern: 'US', replacement: 'Premium' }] },
                },
            },
            {
                type: 'rename',
                params: { template: { enabled: true, template: '{name}-{region}' } },
            },
            { type: 'script', params: { dsl: [{ action: 'rename', template: '⚡ {name}' }] } },
            { type: 'dedup', params: {} },
            { type: 'sort', params: { keys: [{ key: 'name', order: 'desc' }] } },
            {
                type: 'rename',
                params: { template: { enabled: true, template: '{name} {emoji} {globalIndex}' } },
            },
        ];
        const settings = {
            enableAccessLog: false,
            defaultOperators: operators,
            regionOverrides: [{ pattern: 'Premium', region: 'DE', scope: 'all' }],
        };
        const preview = await previewNodeProcessing(urls.join('\n'), null, settings);
        const actual = await generateCombinedNodeList(
            {},
            settings,
            'MiSub-Backend',
            urls.map((url) => ({ url, enabled: true })),
            '',
            { enableManualNodes: false }
        );
        const previewNames = preview.rows
            .filter((row) => !row.filtered)
            .sort((a, b) => a.outputIndex - b.outputIndex)
            .map((row) => row.newName);
        expect(
            actual
                .trim()
                .split('\n')
                .map((url) => decodeURIComponent(url.split('#')[1]))
        ).toEqual(previewNames);
        expect(preview.outputCount).toBe(2);
        expect(preview.rows.filter((row) => row.filtered)).toHaveLength(2);
        expect(previewNames.some((name) => name.includes('德国') && name.includes('🇩🇪'))).toBe(
            true
        );
    });
    it('uses profile rules before globals and supports all three inheritance modes', async () => {
        const settings = { regionOverrides: [{ pattern: 'US', region: 'JP', scope: 'all' }] };
        const profile = { regionOverrides: [{ pattern: 'US', region: 'DE', scope: 'all' }] };
        expect(
            resolveRegionOverrides({ ...profile, regionOverrideMode: 'inherit' }, settings)
        ).toEqual(settings.regionOverrides);
        for (const [mode, flag] of [
            ['inherit', '🇯🇵'],
            ['extend', '🇩🇪'],
            ['replace', '🇩🇪'],
        ]) {
            const result = await previewNodeProcessing(
                'US-01',
                { ...profile, regionOverrideMode: mode },
                settings
            );
            expect(result.rows[0].newName).toBe(`${flag} US-01`);
        }
        expect(
            resolveRegionOverrides({ regionOverrideMode: 'replace', regionOverrides: [] }, settings)
        ).toEqual([]);
    });
    it('keeps removed countries in diagnostics without resurrecting flags through templates', async () => {
        const result = await previewNodeProcessing('⚡ US/JP', null, {
            flagEmojiMode: 'remove',
            defaultOperators: [
                {
                    type: 'rename',
                    params: { template: { enabled: true, template: '{emoji}{name}' } },
                },
            ],
        });
        expect(result.rows[0].newName).toBe('⚡ US/JP');
        expect(result.rows[0].after.conflict).toBe(true);
    });
});

describe('node processing cache versions', () => {
    const storage = (value) => {
        const saved = new Map([['cache', value]]);
        return {
            get: async (key) => saved.get(key),
            put: async (key, entry) => saved.set(key, entry),
            saved,
        };
    };
    it.each([undefined, 'old-v1', 'node-flags-v2', 'node-flags-v3'])(
        'rejects aggregate cache version %s and bypasses old shrink protection',
        async (version) => {
            const store = storage({
                nodes: Array.from({ length: 30 }, (_, i) => uri(`US-${i}`)).join('\n'),
                nodeCount: 30,
                timestamp: Date.now(),
                processingVersion: version,
            });
            expect((await getCache(store, 'cache', NODE_PROCESSING_VERSION)).status).toBe('miss');
            const result = await resolveNodeListWithCache({
                storageAdapter: store,
                cacheKey: 'cache',
                refreshNodes: async () => uri('JP-01'),
                context: {},
                processingVersion: NODE_PROCESSING_VERSION,
            });
            expect(result.cacheHeaders['X-Cache-Status']).toBe('MISS');
            expect(
                await setCache(store, 'cache', uri('JP-01'), [], {
                    processingVersion: NODE_PROCESSING_VERSION,
                })
            ).toBe(true);
            expect((await getCache(store, 'cache', NODE_PROCESSING_VERSION)).status).toBe('fresh');
        }
    );
    it('rejects old per-source caches and keeps matching current entries', async () => {
        const sub = { id: 'sub', url: 'https://source.example' };
        const store = storage(null),
            key = buildSubscriptionNodeCacheKey(sub);
        store.saved.set(key, { nodes: [uri('US')], processingVersion: 'old-v1' });
        expect(await readSubscriptionNodeCache(store, sub)).toBeNull();
        store.saved.get(key).processingVersion = NODE_PROCESSING_VERSION;
        expect((await readSubscriptionNodeCache(store, sub)).nodes).toHaveLength(1);
    });
});
