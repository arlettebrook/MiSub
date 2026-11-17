import { processNodeUrls, resolveNodeProcessing } from '../../utils/node-processing.js';
import { StorageFactory } from '../../storage-adapter.js';
import { createJsonResponse } from '../utils.js';
import { parseNodeInfo } from '../utils/geo-utils.js';
import {
    calculateProtocolStats,
    calculateRegionStats,
    parseNodeList,
} from '../utils/node-parser.js';
import { extractNodeMetadata } from '../utils/metadata-extractor.js';
import { KV_KEY_SUBS, KV_KEY_PROFILES, KV_KEY_SETTINGS, DEFAULT_SETTINGS } from '../config.js';
import { fetchSubscriptionNodes } from './node-fetcher.js';
import { applyManualNodeName } from '../utils/node-cleaner.js';
import { isManualNodeSource, isRemoteSubscriptionSource } from '../../../shared/node-source.js';

/**
 * 处理订阅组模式的节点获取
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @param {string} profileId - 订阅组ID
 * @param {string} userAgent - 用户代理
 * @param {boolean} applyTransform - 是否应用节点转换规则（智能重命名、前缀等）
 * @param {boolean} forceRefresh - 是否绕过上游缓存重新拉取节点
 * @returns {Promise<Object>} 处理结果
 */
export async function handleProfileMode(
    request,
    env,
    profileId,
    userAgent,
    applyTransform = false,
    skipCertVerify = false,
    forceRefresh = false
) {
    const storageAdapter = StorageFactory.createAdapter(
        env,
        await StorageFactory.getStorageType(env)
    );

    const profile =
        typeof storageAdapter.getProfileById === 'function'
            ? await storageAdapter.getProfileById(profileId)
            : ((await storageAdapter.get(KV_KEY_PROFILES)) || []).find(
                  (p) => (p.customId && p.customId === profileId) || p.id === profileId
              );
    const settings = (await storageAdapter.get(KV_KEY_SETTINGS)) || DEFAULT_SETTINGS;

    if (!profile || !profile.enabled) {
        return createJsonResponse({ error: '订阅组不存在或已禁用' }, 404);
    }

    const processing = resolveNodeProcessing(profile, settings, new URL(request.url).searchParams);
    const regionResolver = processing.regionResolver;

    const relatedIds = [
        ...(Array.isArray(profile.subscriptions)
            ? profile.subscriptions.map((item) => (typeof item === 'object' ? item.id : item))
            : []),
        ...(Array.isArray(profile.manualNodes) ? profile.manualNodes : []),
    ].filter(Boolean);
    const relatedSubs =
        typeof storageAdapter.getSubscriptionsByIds === 'function'
            ? await storageAdapter.getSubscriptionsByIds(Array.from(new Set(relatedIds)))
            : (await storageAdapter.get(KV_KEY_SUBS)) || [];
    const misubMap = new Map(relatedSubs.map((item) => [item.id, item]));

    const targetMisubs = [];

    // 1. Add subscriptions in order defined by profile
    const profileSubIds = profile.subscriptions || [];
    if (Array.isArray(profileSubIds)) {
        profileSubIds.forEach((item) => {
            const id = typeof item === 'object' ? item.id : item;
            const sub = misubMap.get(id);
            if (
                sub &&
                sub.enabled &&
                (isRemoteSubscriptionSource(sub) || isManualNodeSource(sub))
            ) {
                targetMisubs.push(typeof item === 'object' ? { ...sub, ...item } : sub);
            }
        });
    }

    // 2. Add manual nodes in order defined by profile
    const profileNodeIds = profile.manualNodes || [];
    if (Array.isArray(profileNodeIds)) {
        profileNodeIds.forEach((id) => {
            const node = misubMap.get(id);
            if (node && node.enabled && isManualNodeSource(node)) {
                targetMisubs.push(node);
            }
        });
    }

    // 分离HTTP订阅和手工节点
    const targetSubscriptions = targetMisubs.filter(isRemoteSubscriptionSource);
    const targetManualNodes = targetMisubs.filter(isManualNodeSource);

    // 处理手工节点（直接解析节点URL）
    // 先将用户自定义名称写入 URL（与订阅生成流程保持一致），
    // 确保 parseNodeInfo 和节点转换管道能基于正确名称工作
    const manualNodeResults = targetManualNodes.map((node) => {
        const customName = typeof node.name === 'string' ? node.name.trim() : '';
        const effectiveUrl = customName ? applyManualNodeName(node.url, customName) : node.url;
        if (applyTransform && customName) {
            const before = extractNodeMetadata(
                parseNodeInfo(node.url, { normalizeFlagDisplay: false }).name,
                { regionResolver }
            ).regionInfo;
            const after = extractNodeMetadata(customName, { regionResolver }).regionInfo;
            regionResolver.remember(
                effectiveUrl,
                after.region === '其他' && before.region !== '其他'
                    ? {
                          ...before,
                          ...(after.groupRegion
                              ? {
                                    groupRegion: after.groupRegion,
                                    groupRuleIndex: after.groupRuleIndex,
                                }
                              : {}),
                      }
                    : after
            );
        }

        const nodeInfo = parseNodeInfo(effectiveUrl);
        const expanded = /^(v2rayn|mierus?):\/\//i.test(node.url)
            ? parseNodeList(node.url)
            : [nodeInfo];
        return {
            subscriptionName: node.name || '手工节点',
            group: node.group || '',
            url: effectiveUrl,
            success: true,
            nodes: expanded.map((parsed) => ({
                ...parsed,
                url: /^(v2rayn|mierus?):\/\//i.test(node.url) ? parsed.url : effectiveUrl,
                subscriptionName: node.name || '手工节点',
                group: node.group || '',
            })),
            error: null,
            isManualNode: true,
        };
    });

    // 并行获取HTTP订阅节点
    const subscriptionResults = await Promise.all(
        targetSubscriptions.map((sub) =>
            fetchSubscriptionNodes(
                sub.url,
                sub.name,
                userAgent,
                sub.customUserAgent,
                false,
                sub.exclude,
                sub.fetchProxy,
                skipCertVerify,
                Boolean(sub?.plusAsSpace),
                sub?.enableNodeCache === true,
                forceRefresh,
                storageAdapter,
                sub,
                regionResolver,
                applyTransform ? processing.flagPolicy : undefined
            )
        )
    );

    // 合并所有结果
    const allResults = [...subscriptionResults, ...manualNodeResults];
    if (allResults.length > 0 && allResults.every((result) => !result.success)) {
        return {
            success: false,
            error: allResults
                .map((result) => result.error)
                .filter(Boolean)
                .join('; '),
            subscriptions: allResults,
            nodes: [],
            totalCount: 0,
        };
    }

    // 统计所有节点
    const allNodes = [];
    allResults.forEach((result) => {
        if (result.success) {
            allNodes.push(
                ...result.nodes.map((node) => ({
                    ...node,
                    subscriptionName: node.subscriptionName || result.subscriptionName || '',
                    group: node.group || result.group || '',
                }))
            );
        }
    });

    // 如果需要应用转换规则，则处理节点名称
    let processedNodes = allNodes;
    if (applyTransform) {
        let nodeUrls = allNodes.map((node) => node.url);
        const nodeMetadataByUrl = new Map();
        for (const node of allNodes)
            if (!nodeMetadataByUrl.has(node.url))
                nodeMetadataByUrl.set(node.url, {
                    group: node.group || '',
                    subscriptionName: node.subscriptionName || '',
                });

        const { operators: activeOperators, flagPolicy } = processing;
        const { urls: transformedUrls, records } = await processNodeUrls(nodeUrls, {
            operators: activeOperators,
            flagPolicy,
            regionResolver,
            config: settings,
            profile,
            subName: profile?.name,
            userAgent,
            nodeMetadataByUrl,
            captureRecords: true,
        });

        processedNodes = transformedUrls.map((transformedUrl, index) => {
            const nodeInfo = parseNodeInfo(transformedUrl, {
                normalizeFlagDisplay: flagPolicy.mode !== 'preserve',
            });
            const record = records[index];
            const hint = record.regionInfo || regionResolver.hint(transformedUrl);
            return {
                ...nodeInfo,
                ...(hint
                    ? {
                          region: hint.region,
                          regionSource: hint.source,
                          regionMatch: hint.matched,
                          regionCandidates: hint.candidates || [],
                          regionConflict: Boolean(hint.conflict),
                          groupRegion: hint.groupRegion || hint.region,
                      }
                    : {}),
                subscriptionName: record.subscriptionName || nodeInfo.subscriptionName || '未知',
                group: record.group || '',
            };
        });
    }

    // 生成统计信息（使用处理后的节点）
    const protocolStats = calculateProtocolStats(processedNodes);
    const regionStats = calculateRegionStats(processedNodes);

    return {
        success: true,
        ...(subscriptionResults.some((result) => result.fromCache) ? { fromCache: true } : {}),
        subscriptions: allResults,
        nodes: processedNodes,
        totalCount: processedNodes.length,
        stats: {
            protocols: protocolStats,
            regions: regionStats,
        },
    };
}
