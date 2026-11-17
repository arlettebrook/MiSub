import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { convertClashProxyToUrl } from '../functions/utils/clash-to-url.js';
import { parseNodeList } from '../functions/modules/utils/node-parser.js';
import { parseNodeInfo } from '../functions/modules/utils/geo-utils.js';
import { generateCombinedNodeList } from '../functions/services/subscription-service.js';
import { previewNodeProcessing } from '../functions/utils/node-processing.js';
import { NODE_PROCESSING_VERSION } from '../shared/node-processing-version.js';

const types = ['trojan', 'vmess', 'ssr', 'ss', 'vless', 'hysteria2', 'tuic', 'anytls'];
const names = ['⚡ US', '🏁 JP', '香港→日本', 'US/JP', '🇹🇼 Premium', 'Unknown', 'DE', 'SG'];
const uuid = '11111111-1111-4111-8111-111111111111';
const settings = {
    enableAccessLog: false,
    defaultOperators: [
        {
            type: 'rename',
            params: {
                regex: { enabled: true, rules: [{ pattern: 'Unknown', replacement: 'Custom' }] },
            },
        },
        {
            type: 'rename',
            params: {
                template: { enabled: true, template: '{emoji}{region}-{protocol}-{index}-{name}' },
            },
        },
        { type: 'sort', params: { keys: [{ key: 'name', order: 'asc' }] } },
        { type: 'dedup', params: {} },
    ],
};
const median = (values) =>
    Number([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(2));
const measurements = [];
const originalLog = console.log;
console.log = () => {};
try {
    for (const count of [1000, 10000]) {
        const urls = Array.from({ length: count }, (_, index) =>
            convertClashProxyToUrl({
                type: types[index % types.length],
                name: `${names[index % names.length]}-${index}`,
                server: `node-${index}.benchmark.example`,
                port: 443,
                uuid,
                password: 'benchmark-password',
                cipher: index % types.length === 2 ? 'aes-256-cfb' : 'aes-128-gcm',
                alterId: 0,
                protocol: 'auth_sha1_v4',
                obfs: 'plain',
                tls: true,
                'skip-cert-verify': true,
            })
        );
        assert.equal(urls.filter(Boolean).length, count);
        const text = urls.join('\n');
        const samples = [];
        let protocolCounts, finalCounts;
        for (let round = 0; round < 4; round++) {
            globalThis.gc?.();
            const beforeHeap = process.memoryUsage().heapUsed;
            const start = performance.now();
            const parsed = parseNodeList(text);
            const parsedAt = performance.now();
            assert.equal(parsed.length, count);
            protocolCounts = Object.fromEntries(
                types.map((type) => [type, parsed.filter((node) => node.protocol === type).length])
            );
            const output = await generateCombinedNodeList(
                {},
                settings,
                'MiSub-Backend',
                parsed.map((node) => ({ url: node.url, enabled: true })),
                '',
                { enableManualNodes: false }
            );
            const convertedAt = performance.now();
            const preview = await previewNodeProcessing(
                parsed.map((node) => node.url).join('\n'),
                null,
                settings
            );
            const previewAt = performance.now();
            assert.equal(preview.outputCount, count);
            const outputNames = output
                .trim()
                .split('\n')
                .map((url) => parseNodeInfo(url).name);
            const previewNames = preview.rows
                .filter((row) => !row.filtered)
                .sort((a, b) => a.outputIndex - b.outputIndex)
                .map((row) => row.newName);
            assert.deepEqual(previewNames, outputNames);
            finalCounts = {
                retained: preview.outputCount,
                conflicts: preview.rows.filter((row) => row.after.conflict).length,
                globeNames: previewNames.filter((name) => name.includes('🌍')).length,
            };
            const allocatedHeapMB = (process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024;
            globalThis.gc?.();
            const retainedHeapMB = (process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024;
            if (round)
                samples.push({
                    parseMs: parsedAt - start,
                    outputMs: convertedAt - parsedAt,
                    previewMs: previewAt - convertedAt,
                    totalMs: previewAt - start,
                    heapMB: allocatedHeapMB,
                    retainedHeapMB,
                    rssMB: process.memoryUsage().rss / 1024 / 1024,
                });
        }
        measurements.push({
            nodes: count,
            protocolCounts,
            ...finalCounts,
            rounds: samples.length,
            ...Object.fromEntries(
                Object.keys(samples[0]).map((key) => [
                    key,
                    median(samples.map((sample) => sample[key])),
                ])
            ),
        });
    }
    // 复现预览来源查找的旧路径：同一节点每次重新解析 URL 并从头扫描。
    const sourceLookup = [];
    for (const count of [1000, 10000]) {
        const urls = Array.from(
            { length: count },
            (_, index) => `trojan://benchmark@node-${index}.example:443#US`
        );
        const parsed = urls.map((url) => new URL(url));
        let legacyMs;
        if (count === 1000) {
            const start = performance.now();
            for (const target of parsed)
                assert.ok(urls.find((url) => new URL(url).hostname === target.hostname));
            legacyMs = performance.now() - start;
        }
        const start = performance.now();
        const byEndpoint = new Map(
            parsed.map((url, index) => [`${url.hostname}:${url.port}`, urls[index]])
        );
        for (const target of parsed) assert.ok(byEndpoint.get(`${target.hostname}:${target.port}`));
        sourceLookup.push({
            nodes: count,
            ...(legacyMs === undefined ? {} : { legacyMs: Number(legacyMs.toFixed(2)) }),
            indexedMs: Number((performance.now() - start).toFixed(2)),
        });
    }
    originalLog(
        JSON.stringify(
            {
                node: process.version,
                platform: process.platform,
                processingVersion: NODE_PROCESSING_VERSION,
                scope: 'Mixed URI parsing, complete subscription transformation and local preview computation; no network or DOM rendering.',
                measurements,
                sourceLookup,
            },
            null,
            2
        )
    );
} finally {
    console.log = originalLog;
}
