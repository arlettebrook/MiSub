import { performance } from 'node:perf_hooks';
import { addFlagEmoji } from '../functions/utils/node-utils.js';
import { createRegionResolver } from '../shared/node-region-context.js';
import { extractNodeMetadata } from '../functions/modules/utils/metadata-extractor.js';

const cases = ['US', 'JP', 'DE', 'HK', 'TW', 'SG', 'BR', 'FR', 'Unknown', 'Unknown'];
const rows = [];
for (const cache of [false, true])
    for (const count of [1000, 10000]) {
        const names = Array.from(
            { length: count },
            (_, index) => `⚡ ${cases[index % cases.length]}-${index}`
        );
        const urls = names.map(
            (name) => `trojan://benchmark@benchmark.example:443#${encodeURIComponent(name)}`
        );
        const samples = [];
        let checksum = 0;
        for (let round = 0; round < 4; round++) {
            globalThis.gc?.();
            const regionResolver = cache ? createRegionResolver() : undefined;
            const start = performance.now();
            for (let pass = 0; pass < 3; pass++) {
                for (let index = 0; index < count; index++) {
                    checksum += extractNodeMetadata(names[index], { regionResolver }).region.length;
                    checksum += addFlagEmoji(urls[index], { regionResolver }).length;
                }
            }
            if (round) samples.push(performance.now() - start);
        }
        rows.push({
            cache,
            nodes: count,
            passes: 3,
            medianMs: Number(samples.sort((a, b) => a - b)[1].toFixed(2)),
            heapMB: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
            checksum,
        });
    }
console.log(
    JSON.stringify(
        { node: process.version, platform: process.platform, measurements: rows },
        null,
        2
    )
);
