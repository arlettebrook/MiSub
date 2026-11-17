import {
    resolveEffectiveNodeTransform,
    resolveNodeOperators,
    resolveNodeFlagPolicy,
} from '../../shared/node-flag-policy.js';
import { createRegionResolver, resolveRegionOverrides } from '../../shared/node-region-context.js';
import { parseNodeInfo } from '../modules/utils/geo-utils.js';
import { adaptLegacyTransform } from './legacy-node-transform.js';
import { runOperatorChain } from './operator-runner.js';
import { applyFlagEmojiPolicy } from './node-transform-settings.js';
import { sanitizeNodeForYaml } from './node-utils.js';
import { applyFilterRules, createNodeFilterPredicate } from './node-filter-rules.js';

export function resolveNodeProcessing(profile, config = {}, searchParams) {
    const transform = resolveEffectiveNodeTransform(profile, config, searchParams);
    let operators = resolveNodeOperators(profile, config, transform);
    if (!operators.length) operators = adaptLegacyTransform(transform);
    return {
        operators,
        flagPolicy: resolveNodeFlagPolicy(profile, config, operators, searchParams),
        regionResolver: createRegionResolver(resolveRegionOverrides(profile, config)),
    };
}

/** 浏览器样本预览和订阅输出共用；不下载订阅或远程脚本。 */
export async function processNodeUrls(nodeUrls, context = {}) {
    const {
        flagPolicy = { mode: 'auto', position: 'prefix' },
        regionResolver,
        operators = [],
        config = {},
        profile,
        trace = false,
    } = context;
    const needRecords =
        trace ||
        context.captureRecords ||
        operators.length > 0 ||
        Boolean(profile?.exclude || config.exclude);
    const firstIndex = new Map();
    nodeUrls.forEach((url, index) => {
        if (!firstIndex.has(url)) firstIndex.set(url, index);
    });
    const uniqueUrls = [...firstIndex.keys()];
    const inputHints = [];
    let urls = applyFlagEmojiPolicy(
        uniqueUrls,
        flagPolicy.mode === 'remove' ? flagPolicy : { ...flagPolicy, template: true },
        regionResolver,
        (info, index) => {
            inputHints[index] = info;
        },
        regionResolver?.hintsFor(uniqueUrls)
    );
    const metadataByUrl =
        context.nodeMetadataByUrl instanceof Map
            ? context.nodeMetadataByUrl
            : new Map(Object.entries(context.nodeMetadataByUrl || {}));
    const nodeMetadata = uniqueUrls.map((url, index) => ({
        ...(metadataByUrl.get(url) || {}),
        ...(trace ? { previewIndex: firstIndex.get(uniqueUrls[index]) } : {}),
    }));
    let records;
    const ruleHits = trace ? new Map() : undefined;
    if (operators.length)
        urls = await runOperatorChain(urls, operators, {
            ...context,
            nodeMetadata,
            regionHints: inputHints,
            onStep: trace
                ? (value) => {
                      for (const record of value) {
                          const info = record.metadata?.regionInfo || {};
                          const hits = ruleHits.get(record.previewIndex) || new Set();
                          for (const index of [info.ruleIndex, info.groupRuleIndex])
                              if (index !== undefined) hits.add(index);
                          ruleHits.set(record.previewIndex, hits);
                      }
                  }
                : undefined,
            onComplete: needRecords
                ? (value) => {
                      records = value;
                  }
                : undefined,
        });
    if (needRecords && !records)
        records = urls.map((url, index) => ({
            ...nodeMetadata[index],
            url,
            metadata: { regionInfo: inputHints[index] },
        }));
    // 链接改名后可能相同，记录按输出顺序保留，不能再以 URL 覆盖记录。
    if (records) {
        if (profile?.exclude || config.exclude) {
            const profileFilter = createNodeFilterPredicate(profile || {}, regionResolver);
            const globalFilter = createNodeFilterPredicate(config, regionResolver);
            records = records.filter(
                (record) =>
                    profileFilter(record.url, record.metadata?.regionInfo) &&
                    globalFilter(record.url, record.metadata?.regionInfo)
            );
        }
        urls = records.map((record) => record.url);
    } else
        urls = applyFilterRules(
            applyFilterRules(urls, profile || {}, regionResolver),
            config,
            regionResolver
        );
    const sanitized = urls.map((url) => {
        const next = sanitizeNodeForYaml(url);
        const hint = regionResolver?.hint(url);
        if (hint) regionResolver.remember(next, hint);
        return next;
    });
    const finalHints = [];
    urls = applyFlagEmojiPolicy(
        sanitized,
        flagPolicy,
        regionResolver,
        (info, index) => {
            finalHints[index] = info;
        },
        records ? records.map((record) => record.metadata?.regionInfo) : inputHints
    );
    if (records)
        records = urls.map((url, index) => ({
            ...records[index],
            url,
            regionInfo: finalHints[index],
        }));
    regionResolver?.rememberList(urls, finalHints);
    return { urls, records, ruleHits };
}

export async function previewNodeProcessing(samples, profile, config = {}) {
    const lines = String(samples || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const urls = lines.map((line, index) =>
        /^[a-z][a-z\d+.-]*:\/\//i.test(line)
            ? line
            : `unknown://sample-${index}.invalid:443#${encodeURIComponent(line)}`
    );
    const names = urls.map(
        (url) => parseNodeInfo(url, { normalizeFlagDisplay: false, identifyRegion: false }).name
    );
    const resolved = resolveNodeProcessing(profile, config);
    const effectiveRules = resolveRegionOverrides(profile, config);
    const originals = names.map((name) => ({
        name,
        before: resolved.regionResolver.resolveOriginal(name),
        after: resolved.regionResolver.resolve(name),
        group: resolved.regionResolver.resolve(name, 'group'),
    }));
    const result = await processNodeUrls(urls, {
        ...resolved,
        config,
        profile,
        subName: profile?.name || '',
        trace: true,
    });
    const outputs = new Map(
        result.records.map((record, index) => [record.previewIndex, { ...record, index }])
    );
    const rows = originals.map((original, index) => {
        const output = outputs.get(index);
        const hint = output?.regionInfo || (output && resolved.regionResolver.hint(output.url));
        const info = hint || original.after;
        const group = info.groupRegion
            ? {
                  ...info,
                  region: info.groupRegion,
                  source: 'override',
                  ruleIndex: info.groupRuleIndex,
                  matched: effectiveRules[info.groupRuleIndex]?.pattern || info.matched,
              }
            : original.group;
        const ruleHits = [
            ...new Set(
                [
                    original.after.ruleIndex,
                    original.group.ruleIndex,
                    info.ruleIndex,
                    info.groupRuleIndex,
                    ...(result.ruleHits.get(index) || []),
                ].filter((value) => value !== undefined)
            ),
        ];
        return {
            ...original,
            after: info,
            group,
            ruleHits,
            filtered: !output,
            outputIndex: output?.index,
            newName: output
                ? parseNodeInfo(output.url, {
                      identifyRegion: false,
                      normalizeFlagDisplay: resolved.flagPolicy.mode !== 'preserve',
                  }).name
                : '',
            reason: info.source === 'override' ? info : group.source === 'override' ? group : info,
        };
    });
    return { rows, errors: resolved.regionResolver.errors, outputCount: result.urls.length };
}
