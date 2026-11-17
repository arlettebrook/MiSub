// @vitest-environment node
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { addFlagEmoji, removeFlagEmoji } from '../../functions/utils/node-utils.js';
import { urlsToClashProxies } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { extractNodeMetadata } from '../../functions/modules/utils/metadata-extractor.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';
import { groupNodeLinesByRegion } from '../../functions/modules/subscription/region-groups.js';
import { transformBuiltinSubscription } from '../../functions/modules/subscription/transformer-factory.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { getNodeFlagEmoji, hasNodeFlagEmoji, stripNodeFlagEmoji } from '../../shared/node-emoji.js';
import {
    extractNodeRegion,
    getRegionEmoji,
    getRegionDisplayEmoji,
    getRegionCode,
    containsRegion,
    getRegionGroupName,
} from '../../shared/node-regions.js';
import { filterManualNodes } from '../../src/composables/manual-nodes/filters.js';
import { buildAutoSortedSubscriptions } from '../../src/composables/manual-nodes/sorting.js';

const uri = (name) => `trojan://pass@example.com:443#${encodeURIComponent(name)}`;
const vmess = (name) =>
    'vmess://' +
    Buffer.from(
        JSON.stringify({
            v: '2',
            ps: name,
            add: 'example.com',
            port: '443',
            id: '11111111-1111-4111-8111-111111111111',
            net: 'tcp',
        })
    ).toString('base64');
const ssr = (name) =>
    convertClashProxyToUrl({
        name,
        type: 'ssr',
        server: 'example.com',
        port: 12345,
        protocol: 'auth_aes128_sha1',
        cipher: 'chacha20-ietf',
        obfs: 'plain',
        password: 'password',
    });
const nameOf = (url) => urlsToClashProxies([url], { addFlagEmoji: false })[0].name;
const scotland =
    '🏴' +
    [...'gbsct'].map((char) => String.fromCodePoint(char.charCodeAt(0) + 0xe0000)).join('') +
    '\u{E007F}';

describe('one shared emoji definition', () => {
    it.each(['🇺🇸', '🇺🇸\uFE0F', '🌍', '🌎', '🌏', '🌐', '🏁', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', scotland])(
        'recognizes the entire %s flag sequence and strips it cleanly',
        (flag) => {
            expect(getNodeFlagEmoji(`${flag} US-01`)).toBe(flag);
            expect(hasNodeFlagEmoji(`${flag} US-01`)).toBe(true);
            expect(stripNodeFlagEmoji(`${flag} US-01`)).toBe('US-01');
            expect(stripNodeFlagEmoji(`${flag} US-01`)).not.toMatch(
                /[\uFE0F\u200D\u{E0061}-\u{E007F}]/u
            );
        }
    );

    it.each([
        ['URI', uri],
        ['VMess', vmess],
        ['SSR', ssr],
    ])('is idempotent for known, unknown and existing flags in %s', (_label, encode) => {
        for (const name of [
            'US-01',
            'CustomNode',
            '🌍 CustomNode',
            '🌐 CustomNode',
            '🇺🇸 Premium-01',
            `${scotland} Premium-01`,
        ]) {
            const added = addFlagEmoji(encode(name));
            expect(addFlagEmoji(added), name).toBe(added);
            expect(nameOf(added), name).not.toContain('🌍 🌍');
            const stripped = removeFlagEmoji(added);
            expect(removeFlagEmoji(stripped), name).toBe(stripped);
            expect(nameOf(stripped), name).not.toMatch(/🇺🇸|🌍/u);
            if (name.includes('🌐')) expect(nameOf(stripped)).toContain('🌐');
        }
    });

    it('preserves unrelated technical emoji', () => {
        expect(nameOf(addFlagEmoji(uri('⚡ US-01')))).toBe('🇺🇸 ⚡ US-01');
        expect(nameOf(removeFlagEmoji(uri('🇺🇸 ⚡ US-01')))).toBe('⚡ US-01');
    });

    it('keeps an existing flag fragment byte-for-byte without unnecessary re-encoding', () => {
        const url = 'trojan://pass@example.com:443#🌍%20CustomNode';
        expect(addFlagEmoji(url)).toBe(url);
    });

    it('supports URL-encoded, URL-safe VMess payloads', () => {
        const input = vmess('US-01').replace(/^vmess:\/\//, 'VMESS://');
        const payload = input.slice(8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const added = addFlagEmoji('VMESS://' + encodeURIComponent(payload));
        expect(nameOf(added)).toBe('🇺🇸 US-01');
        expect(nameOf(removeFlagEmoji(added))).toBe('US-01');
    });

    it('clears SSR remarks even when the original name consists only of a flag', () => {
        const stripped = removeFlagEmoji(ssr('🇺🇸'));
        const decoded = Buffer.from(stripped.slice(6), 'base64url').toString('utf8');
        expect(new URLSearchParams(decoded.split('/?')[1]).get('remarks')).toBe('');
        expect(urlsToClashProxies([stripped], { addFlagEmoji: false })[0]).toMatchObject({
            type: 'ssr',
            password: 'password',
            server: 'example.com',
            port: 12345,
        });
    });
});

describe('names retain literal URI escapes', () => {
    it.each([
        'JP-50%',
        'US-literal%2F',
        'US-literal%20',
        'US-literal%25',
        'US-invalid%ZZ',
        'US-100% + test',
    ])('preserves %s across adding and removing flags', (name) => {
        const original = uri(name);
        const added = addFlagEmoji(original);
        expect(nameOf(added)).toBe(`${getRegionEmoji(extractNodeRegion(name))} ${name}`);
        expect(addFlagEmoji(added)).toBe(added);
        expect(removeFlagEmoji(added)).toBe(original);
    });

    it('does not throw or lose malformed percent sequences', () => {
        const original = 'trojan://pass@example.com:443#US-%E0%A4%A';
        const added = addFlagEmoji(original);
        expect(nameOf(added)).toBe('🇺🇸 US-%E0%A4%A');
        expect(addFlagEmoji(added)).toBe(added);
    });
});

describe('region identity and presentation', () => {
    it.each([
        ['🇺🇸 Premium-01', '美国'],
        ['🇹🇼 Premium-01', '台湾'],
        ['🇨🇳 台湾-01', '台湾'],
        ['🇨🇳 CN-01', '中国'],
        ['user US-01', '美国'],
        ['business-US-01', '美国'],
        ['customnode-DE-01', '德国'],
        ['kristi-KR-01', '韩国'],
        ['user', '其他'],
        ['business', '其他'],
        ['CustomNode', '其他'],
        ['HKNode', '其他'],
        ['港01', '香港'],
        ['台-01', '台湾'],
        ['美01', '美国'],
        ['日 01', '日本'],
        ['韩-01', '韩国'],
        ['英01', '英国'],
        ['德01', '德国'],
        ['法01', '法国'],
        ['新01', '新加坡'],
        ['澳洲01', '澳大利亚'],
        ['England-01', '英国'],
        ['每日流量', '其他'],
        ['美丽节点', '其他'],
        ['新增节点', '其他'],
        ['美國-01', '美国'],
        ['英國-01', '英国'],
        ['澳大利亞-01', '澳大利亚'],
        ['印度尼西亚-01', '印尼'],
        ['印度尼西亞-01', '印尼'],
        ['臺灣-01', '台湾'],
        ['United Kingdom-01', '英国'],
        [`${scotland} Premium-01`, '英国'],
    ])('identifies %s as %s without substring false positives', (name, region) => {
        expect(extractNodeRegion(name)).toBe(region);
        expect(extractNodeMetadata(name).region).toBe(region);
        expect(groupNodeLinesByRegion([{ name }])[0].name).toBe(getRegionGroupName(region));
    });

    it('uses the same boundaries in containsRegion', () => {
        expect(containsRegion('user', '美国')).toBe(false);
        expect(containsRegion('user US-01', 'US')).toBe(true);
        expect(containsRegion('🇺🇸 Premium-01', '美国')).toBe(true);
    });

    it('keeps TW/CN codes distinct while sharing the configured display flag', () => {
        expect(getRegionCode('台湾')).toBe('TW');
        expect(getRegionCode('中国')).toBe('CN');
        expect(getRegionEmoji('TW')).toBe('🇨🇳');
        expect(getRegionEmoji('Taiwan')).toBe('🇨🇳');
        expect(getRegionEmoji('台湾')).toBe('🇨🇳');
        expect(getRegionEmoji('CN')).toBe('🇨🇳');
        expect(getRegionDisplayEmoji('Other')).toBe('🌍');
        expect(getRegionDisplayEmoji('🇺🇸 Unknown')).toBe('🇺🇸');
        expect(getRegionDisplayEmoji('🇹🇼 Unknown')).toBe('🇨🇳');
    });

    it.each(['台湾-01', '🇹🇼 Taiwan-01', '🇹🇼 Premium-01'])(
        'aligns the preview, proxy name, metadata and group for %s',
        async (name) => {
            const source = uri(name);
            const combined = await generateCombinedNodeList(
                {},
                { enableFlagEmoji: true },
                'ClashMeta',
                [{ enabled: true, url: source }],
                '',
                { enableManualNodes: false }
            );
            const preview = parseNodeInfo(combined.trim());
            const proxy = urlsToClashProxies([combined.trim()])[0];
            expect(preview.region).toBe('台湾');
            expect(proxy.metadata.region).toBe('台湾');
            expect(preview.name).toBe(proxy.name);
            expect(proxy.name).toContain('🇨🇳');
            expect(proxy.name).not.toContain('🇹🇼');
            expect(groupNodeLinesByRegion([proxy])[0].name).toBe('🇨🇳 台湾节点');
        }
    );

    it.each(['clash', 'surge', 'loon', 'quanx', 'singbox', 'egern'])(
        'uses consistent Taiwanese group names and references for %s',
        (target) => {
            const output = transformBuiltinSubscription(uri('台湾-01'), target, {
                fileName: 'P2 Flags',
                ruleLevel: 'std',
            });
            if (target === 'egern')
                expect(yaml.load(output).proxies[0].trojan.name).toBe('🇨🇳 台湾-01');
            else expect(output).toContain('🇨🇳 台湾节点');
            expect(output).not.toContain('🇹🇼 台湾节点');
            if (target === 'clash') {
                const parsed = yaml.load(output);
                const names = new Set([
                    ...parsed.proxies.map((proxy) => proxy.name),
                    ...parsed['proxy-groups'].map((group) => group.name),
                    'DIRECT',
                    'REJECT',
                ]);
                for (const group of parsed['proxy-groups'])
                    for (const name of group.proxies || [])
                        expect(names.has(name), `${group.name} -> ${name}`).toBe(true);
            }
        }
    );
});

describe('region override regex state', () => {
    it.each(['g', 'gi', 'y', 'gy'])('resets %s regex state for each node', (flags) => {
        const nodes = [1, 2, 3, 4].map((index) => ({ name: `X-${index}` }));
        const rules = [{ pattern: '^X', region: 'US', flags }];
        for (let run = 0; run < 2; run++) {
            expect(
                groupNodeLinesByRegion(nodes, { regionOverrides: rules }).map((group) => ({
                    name: group.name,
                    count: group.count,
                }))
            ).toEqual([{ name: '🇺🇸 美国节点', count: 4 }]);
        }
    });

    it('keeps sticky anchoring and first-match priority', () => {
        const groups = groupNodeLinesByRegion([{ name: 'X-1' }, { name: 'prefix X-2' }], {
            regionOverrides: [
                { pattern: 'X', region: '美国', flags: 'y' },
                { pattern: 'X', region: '日本', flags: 'g' },
            ],
        });
        expect(groups.map((group) => [group.name, group.tags])).toEqual([
            ['🇺🇸 美国节点', ['X-1']],
            ['🇯🇵 日本节点', ['prefix X-2']],
        ]);
    });

    it('ignores invalid rules and keeps user-defined region labels', () => {
        expect(
            groupNodeLinesByRegion([{ name: 'X' }], {
                regionOverrides: [
                    { pattern: '[', region: '美国' },
                    { pattern: 'X', region: '火星' },
                ],
            })[0].name
        ).toBe('🌍 火星节点');
    });
});

describe('manual-node region searches and sorting', () => {
    const nodes = ['🇨🇳 台湾-01', '🇨🇳 CN-01', '🇹🇼 Premium-01', '🇺🇸 Premium-01'].map(
        (name, index) => ({ id: String(index), name, url: uri(name) })
    );
    it('does not confuse TW and CN when searching shared display flags', () => {
        expect(filterManualNodes(nodes, 'tw').map((node) => node.id)).toEqual(['0', '2']);
        expect(filterManualNodes(nodes, 'cn').map((node) => node.id)).toEqual(['1']);
        expect(filterManualNodes(nodes, 'us').map((node) => node.id)).toEqual(['3']);
    });
    it('sorts flag-only names using region identity', () => {
        const input = ['🇺🇸 Premium-01', 'Other', '🇹🇼 Premium-01', '🇭🇰 Premium-01'].map((name) => ({
            name,
            url: uri(name),
        }));
        expect(buildAutoSortedSubscriptions([], input).map((node) => node.name)).toEqual([
            '🇭🇰 Premium-01',
            '🇹🇼 Premium-01',
            '🇺🇸 Premium-01',
            'Other',
        ]);
    });

    it('retains literal text filtering for queries containing both a flag and a name', () => {
        expect(filterManualNodes(nodes, '🇺🇸 Premium').map((node) => node.id)).toEqual(['3']);
    });

    it('keeps flag-only Taiwanese identity through sorting workflows', async () => {
        const combined = await generateCombinedNodeList(
            {},
            { enableFlagEmoji: true },
            'ClashMeta',
            [{ enabled: true, url: uri('🇹🇼 Premium-01') }],
            '',
            {
                enableManualNodes: false,
                operators: [{ type: 'sort', params: { keys: [{ key: 'name' }] } }],
            }
        );
        expect(urlsToClashProxies([combined.trim()])[0].metadata.region).toBe('台湾');
    });
});
