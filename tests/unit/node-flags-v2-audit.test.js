// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewNodeProcessing } from '../../functions/utils/node-processing.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { resolveSourceFlagPolicyFingerprint } from '../../shared/node-flag-policy.js';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';
import { createRegionResolver } from '../../shared/node-region-context.js';

const createAdapter = vi.fn();
vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: async () => 'kv',
    },
}));
const uri = (name, password = 'pass') =>
    `trojan://${password}@relay.example:443#${encodeURIComponent(name)}`;
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('source caches and flag-mode dependencies', () => {
    it.each([
        [true, 'remove', 'auto'],
        [true, 'auto', 'remove'],
        [false, 'remove', 'auto'],
        [false, 'auto', 'remove'],
    ])(
        'checks source flag-mode dependency=%s from %s to %s',
        async (dependent, startMode, nextMode) => {
            const data = new Map();
            const storage = {
                get: async (key) => data.get(key),
                put: async (key, value) => data.set(key, value),
            };
            const sub = {
                id: 'sub',
                name: 'Airport',
                enabled: true,
                enableNodeCache: true,
                url: 'https://source.example/sub',
                operators: [
                    {
                        type: 'rename',
                        params: {
                            template: { enabled: true, template: dependent ? '{emoji}' : '{name}' },
                        },
                    },
                ],
            };
            const options = { enableManualNodes: false, enableSubscriptions: false };
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response(uri('US-01')))
            );
            await generateCombinedNodeList(
                { storage },
                { flagEmojiMode: startMode, enableAccessLog: false },
                'MiSub-Backend',
                [sub],
                '',
                options
            );
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('', { status: 404 }))
            );
            const result = await generateCombinedNodeList(
                { storage },
                { flagEmojiMode: nextMode, enableAccessLog: false },
                'MiSub-Backend',
                [sub],
                '',
                options
            );
            expect(decodeURIComponent(result)).toBe(
                dependent
                    ? ''
                    : `${uri('US-01').split('#')[0]}#${nextMode === 'auto' ? '🇺🇸 ' : ''}US-01\n`
            );
            const preview = await fetchSubscriptionNodes(
                sub.url,
                'Airport',
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
                createRegionResolver(),
                { mode: nextMode }
            );
            expect(preview.fromCache === true).toBe(!dependent);
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response(uri('US-01')))
            );
            const fresh = await generateCombinedNodeList(
                { storage },
                { flagEmojiMode: nextMode, enableAccessLog: false },
                'MiSub-Backend',
                [sub],
                '',
                options
            );
            expect(decodeURIComponent(fresh)).toContain(
                nextMode === 'remove' ? '#US-01\n' : dependent ? '#🇺🇸\n' : '#🇺🇸 US-01\n'
            );
        }
    );
    it('tracks emoji replacements, but not literal patterns or disabled rules', () => {
        const op = (enabled, replacement) => ({
            type: 'rename',
            params: { regex: { enabled, rules: [{ pattern: '{emoji}', replacement }] } },
        });
        expect(
            resolveSourceFlagPolicyFingerprint(
                { operators: [op(true, 'Prefix')] },
                { mode: 'auto' }
            )
        ).toBeUndefined();
        expect(
            resolveSourceFlagPolicyFingerprint(
                { operators: [op(false, '{emoji}')] },
                { mode: 'auto' }
            )
        ).toBeUndefined();
        expect(
            resolveSourceFlagPolicyFingerprint(
                { operators: [op(true, '{emoji}')] },
                { mode: 'auto' }
            )
        ).not.toBe(
            resolveSourceFlagPolicyFingerprint(
                { operators: [op(true, '{emoji}')] },
                { mode: 'remove' }
            )
        );
        const source = {
            operators: [
                { type: 'rename', params: { template: { enabled: true, template: '{emoji}' } } },
            ],
        };
        expect(
            resolveSourceFlagPolicyFingerprint(source, { mode: 'auto', position: 'prefix' })
        ).toBe(
            resolveSourceFlagPolicyFingerprint(source, { mode: 'preserve', position: 'suffix' })
        );
    });
});

describe('preview record identity through URL collisions', () => {
    it('applies the final whitelist to each original country after flag removal', async () => {
        const result = await previewNodeProcessing(
            [uri('🇺🇸 Premium'), uri('🇯🇵 Premium')].join('\n'),
            null,
            { flagEmojiMode: 'remove', exclude: 'keep: JP' }
        );
        expect(result.rows.map((row) => row.filtered)).toEqual([true, false]);
        expect(result.outputCount).toBe(1);
    });
    it.each(['include', 'regions'])(
        'keeps corrected ISO regions after renaming with a %s filter',
        async (type) => {
            const params =
                type === 'include'
                    ? { include: { enabled: true, rules: ['JP'] } }
                    : { regions: { enabled: true, values: ['JP'] } };
            const result = await previewNodeProcessing(uri('US VIP'), null, {
                regionOverrides: [{ pattern: 'VIP', region: 'JP', scope: 'all' }],
                defaultOperators: [
                    {
                        type: 'rename',
                        params: { template: { enabled: true, template: 'Premium' } },
                    },
                    { type: 'filter', params },
                ],
            });
            expect(result.outputCount).toBe(1);
            expect(result.rows[0].after.code).toBe('JP');
        }
    );
    it('keeps both rows when two renamed URLs become identical', async () => {
        const result = await previewNodeProcessing([uri('US-a'), uri('US-b')].join('\n'), null, {
            defaultOperators: [
                { type: 'rename', params: { template: { enabled: true, template: '{region}' } } },
            ],
        });
        expect(result.outputCount).toBe(2);
        expect(result.rows.map((row) => row.filtered)).toEqual([false, false]);
        expect(result.rows.map((row) => row.outputIndex)).toEqual([0, 1]);
        expect(result.rows.map((row) => row.newName)).toEqual(['美国', '美国']);
    });
    it.each(['auto', 'remove'])(
        'keeps source rows through %s-mode pre-format collisions',
        async (mode) => {
            const result = await previewNodeProcessing(
                [uri('🌍 US-a'), uri('US-a')].join('\n'),
                null,
                { flagEmojiMode: mode }
            );
            expect(result.outputCount).toBe(2);
            expect(result.rows.map((row) => row.filtered)).toEqual([false, false]);
            expect(result.rows.map((row) => row.outputIndex)).toEqual([0, 1]);
        }
    );
    it('retains distinct region hints when flag removal coalesces input URLs', async () => {
        const result = await previewNodeProcessing(
            [uri('🇺🇸 Premium'), uri('🇯🇵 Premium')].join('\n'),
            null,
            {
                flagEmojiMode: 'remove',
                defaultOperators: [
                    {
                        type: 'rename',
                        params: { template: { enabled: true, template: '{region}-{index}' } },
                    },
                ],
            }
        );
        expect(result.rows.map((row) => row.newName)).toEqual(['美国-1', '日本-1']);
        expect(result.rows.map((row) => row.after.code)).toEqual(['US', 'JP']);
    });
});

describe('profile source provenance', () => {
    it('keeps source labels for nodes sharing a relay host and port through sorting', async () => {
        const nodes = [
            { id: 'us', enabled: true, name: 'US-01', url: uri('US-01', 'uspass') },
            { id: 'jp', enabled: true, name: 'JP-01', url: uri('JP-01', 'jppass') },
        ];
        createAdapter.mockReturnValue({
            getProfileById: async () => ({
                id: 'group',
                enabled: true,
                manualNodes: ['us', 'jp'],
                subscriptions: [],
                operators: [
                    { type: 'sort', params: { keys: [{ key: 'name', order: 'asc' }] } },
                    {
                        type: 'rename',
                        params: { template: { enabled: true, template: '{region}-{globalIndex}' } },
                    },
                ],
            }),
            getSubscriptionsByIds: async () => nodes,
            get: async () => ({ enableFlagEmoji: false, enableAccessLog: false }),
        });
        const result = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'group',
            'mihomo',
            true
        );
        expect(result.nodes.map((node) => node.subscriptionName)).toEqual(['JP-01', 'US-01']);
    });
    it('attaches the airport label to HTTP nodes before the processing chain', async () => {
        const sub = {
            id: 'sub',
            enabled: true,
            name: 'Airport A',
            url: 'https://airport.example/sub',
        };
        createAdapter.mockReturnValue({
            getProfileById: async () => ({
                id: 'group',
                enabled: true,
                manualNodes: [],
                subscriptions: ['sub'],
            }),
            getSubscriptionsByIds: async () => [sub],
            get: async () => ({ enableFlagEmoji: false, enableAccessLog: false }),
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(uri('US-01')))
        );
        const result = await handleProfileMode(
            new Request('https://misub.example/api/subscription_nodes'),
            {},
            'group',
            'mihomo',
            true
        );
        expect(result.nodes[0].subscriptionName).toBe('Airport A');
    });
});
