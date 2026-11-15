import { parseNodeList } from '../utils/node-parser.js';
import { fetchWithRetry } from '../../services/fetch-utils.js';
import { buildFetchProxyUrl } from '../../utils/fetch-proxy-utils.js';
import {
    readSubscriptionNodeCache,
    buildSubscriptionFilterFingerprint,
} from '../../services/subscription-service.js';
import { isLocalProxyEndpoint } from '../../utils/node-utils.js';
import {
    isCacheFilterCompatible,
    isSuspiciousNodeCountDrop,
} from '../../services/node-cache-service.js';
import {
    filterNodeObjects,
    parseFilterRuleText,
    encodeArrayBufferToBase64,
} from '../utils/node-cleaner.js';

/**
 * 获取单个订阅的节点
 * @param {string} url - 订阅URL
 * @param {string} subscriptionName - 订阅名称
 * @param {string} userAgent - 用户代理
 * @param {string} customUserAgent - 自定义用户代理 (可选)
 * @param {boolean} debug - 是否启用调试日志
 * @param {string} excludeRules - 过滤规则文本
 * @param {boolean} skipCertVerify - 是否跳过 TLS 证书校验
 * @param {boolean} plusAsSpace - 是否将名称中的 + 视为空格
 * @param {boolean} enableNodeCache - 是否绕过上游缓存以刷新保护性缓存
 * @param {boolean} forceRefresh - 是否强制重新拉取预览节点
 * @param {Object|null} storageAdapter - 已保存订阅的存储适配器
 * @param {Object|null} subscription - 用于定位缓存和核对过滤配置的已保存订阅
 * @returns {Promise<Object>} 节点获取结果
 */
export async function fetchSubscriptionNodes(
    url,
    subscriptionName,
    userAgent,
    customUserAgent = null,
    debug = false,
    excludeRules = '',
    fetchProxy = null,
    skipCertVerify = false,
    plusAsSpace = false,
    enableNodeCache = false,
    forceRefresh = false,
    storageAdapter = null,
    subscription = null
) {
    // 自动检测调试 Token
    const shouldDebug = debug || (url && url.includes('b0b422857bb46aba65da8234c84f38c6'));
    const canReadCache =
        enableNodeCache &&
        subscription?.enableNodeCache === true &&
        subscription.url === url &&
        storageAdapter &&
        !forceRefresh;
    let cacheEntryPromise;
    const readCacheEntry = () => {
        if (!canReadCache) return Promise.resolve(null);
        cacheEntryPromise ||= readSubscriptionNodeCache(storageAdapter, subscription);
        return cacheEntryPromise;
    };
    const failedResult = async (upstreamError) => {
        const cached = await readCacheEntry();
        if (
            cached &&
            isCacheFilterCompatible(cached, buildSubscriptionFilterFingerprint(subscription))
        ) {
            // These URLs already carry the source's filters/operators. Reapplying
            // them can remove renamed nodes or execute an operator twice.
            const nodes = parseNodeList(cached.nodes.join('\n'), { plusAsSpace });
            if (nodes.length > 0 || cached.nodes.length === 0) {
                return {
                    subscriptionName,
                    url,
                    success: true,
                    nodes,
                    error: upstreamError,
                    fromCache: true,
                    cacheUpdatedAt: cached.updatedAt || null,
                };
            }
        }
        return { subscriptionName, url, success: false, nodes: [], error: upstreamError };
    };

    try {
        const effectiveUserAgent =
            customUserAgent && customUserAgent.trim() !== '' ? customUserAgent : userAgent;

        // 当配置了 fetchProxy 时，使用代理拉取订阅
        let requestUrl = url;

        // 手动刷新和保护性缓存刷新都绕过上游缓存。
        if (enableNodeCache || forceRefresh) {
            try {
                const parsedUrl = new URL(requestUrl);
                parsedUrl.searchParams.set('_t', Date.now().toString());
                requestUrl = parsedUrl.toString();
            } catch (e) {
                requestUrl += (requestUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
            }
        }

        if (fetchProxy && typeof fetchProxy === 'string' && fetchProxy.trim()) {
            requestUrl = buildFetchProxyUrl(fetchProxy, requestUrl, effectiveUserAgent);
        }

        // 使用统一的 Fetch 工具，复用重试逻辑
        const response = await fetchWithRetry(requestUrl, {
            headers: {
                'User-Agent': effectiveUserAgent,
                ...(forceRefresh ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {}),
            },
            redirect: 'follow',
            ...(skipCertVerify ? { cf: { insecureSkipVerify: true } } : {}),
        });

        if (!response.ok) {
            return await failedResult(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buffer);

        let parsedNodes = parseNodeList(text, { plusAsSpace });

        if (parsedNodes.length === 0) {
            const fallbackBase64 = encodeArrayBufferToBase64(buffer);
            const fallbackNodes = parseNodeList(fallbackBase64, { plusAsSpace });
            if (fallbackNodes.length > 0) {
                parsedNodes = fallbackNodes;
            }
        }

        // An expired page can return HTTP 200. Check the unfiltered real-node
        // count so intentional filtering to zero never triggers cache fallback.
        const rawNodeCount = parsedNodes.filter((node) => !isLocalProxyEndpoint(node)).length;
        if (rawNodeCount === 0)
            return await failedResult('No valid proxy nodes found in upstream response');
        if (enableNodeCache && subscription) {
            const cached = await readCacheEntry();
            const previousCount = Math.max(
                Number(subscription.lastGoodNodeCount) || 0,
                Number(subscription.nodeCount) || 0,
                Number(cached?.upstreamNodeCount) || cached?.nodes.length || 0
            );
            if (isSuspiciousNodeCountDrop(previousCount, rawNodeCount)) {
                return await failedResult(
                    `Upstream node count dropped unexpectedly (${previousCount} -> ${rawNodeCount})`
                );
            }
        }

        if (excludeRules && excludeRules.trim()) {
            parsedNodes = applyExcludeRulesToNodes(parsedNodes, excludeRules);
        }

        return {
            subscriptionName,
            url,
            success: true,
            nodes: parsedNodes,
            error: null,
        };
    } catch (e) {
        if (shouldDebug) {
            console.debug(`[DEBUG PREVIEW] Error: ${e.message}`);
        }
        return failedResult(e.message);
    }
}

/**
 * 应用过滤规则 (使用 node-cleaner 的重构逻辑)
 * @param {Array} nodes
 * @param {string} ruleText
 */
function applyExcludeRulesToNodes(nodes, ruleText) {
    if (!ruleText || !ruleText.trim()) return nodes;
    const { includeRules, excludeRules } = parseFilterRuleText(ruleText);

    let resultNodes = nodes;

    // 使用 node-cleaner 中导出的 filterNodeObjects
    if (includeRules.hasRules) {
        resultNodes = filterNodeObjects(resultNodes, includeRules, 'include');
    }
    if (excludeRules.hasRules) {
        resultNodes = filterNodeObjects(resultNodes, excludeRules, 'exclude');
    }

    return resultNodes;
}
