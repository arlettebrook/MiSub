import {
    identifyNodeRegion,
    normalizeRegionName,
    getRegionEmoji,
    getRegionCode,
} from './node-regions.js';
import { stripCountryFlagEmoji } from './node-emoji.js';

/** 组内规则在全局规则之前；inherit 不启用组内规则，replace 不启用全局规则。 */
export function resolveRegionOverrides(profile, config = {}) {
    const globalRules = Array.isArray(config.regionOverrides) ? config.regionOverrides : [];
    const localRules = Array.isArray(profile?.regionOverrides) ? profile.regionOverrides : [];
    const mode = profile?.regionOverrideMode || (localRules.length ? 'extend' : 'inherit');
    return mode === 'replace'
        ? [...localRules]
        : mode === 'extend'
          ? [...localRules, ...globalRules]
          : [...globalRules];
}

export function compileRegionOverrides(overrides = []) {
    const rules = [],
        errors = [];
    if (!Array.isArray(overrides)) return { rules, errors };
    overrides.forEach((rule, index) => {
        if (!rule?.pattern || !rule?.region) return;
        try {
            rules.push({
                pattern: new RegExp(rule.pattern, rule.flags || 'i'),
                region: normalizeRegionName(String(rule.region)) || String(rule.region).trim(),
                scope: rule.scope === 'all' ? 'all' : 'group',
                index,
            });
        } catch (error) {
            errors.push({ index, message: error.message });
        }
    });
    return { rules, errors };
}

/** 请求内缓存；不在 Worker 或浏览器全局持有节点名称。 */
export function createRegionResolver(overrides = [], { capacity = 20000, cache = true } = {}) {
    const { rules, errors } = compileRegionOverrides(overrides);
    const names = new Map(),
        hints = new Map();
    // 单份输出按位置保存身份；多个节点改名成相同链接时不能用 URL 覆盖。
    let listedUrls = [],
        listedHints = [];
    function hintsFor(urls) {
        return urls.length === listedUrls.length &&
            urls.every((url, index) => url === listedUrls[index])
            ? listedHints
            : urls.map((url) => hints.get(url));
    }
    function rememberList(urls, infos) {
        listedUrls = [...urls];
        listedHints = urls.map((_url, index) => infos[index]);
        listedUrls.forEach((url, index) => {
            if (listedHints[index]) put(hints, url, listedHints[index]);
        });
    }
    const stats = { hits: 0, misses: 0 };
    const put = (map, key, value) => {
        if (map.size >= capacity && !map.has(key)) map.delete(map.keys().next().value);
        map.set(key, value);
        return value;
    };
    function resolveOriginal(name) {
        name = String(name || '');
        const entry = (cache && names.get(name)) || {};
        if (!entry.original) entry.original = identifyNodeRegion(name);
        if (cache) put(names, name, entry);
        return entry.original;
    }
    function resolve(name, scope = 'all') {
        name = String(name || '');
        const slot = rules.length ? scope : 'all';
        const entry = (cache && names.get(name)) || {};
        if (entry[slot]) {
            stats.hits++;
            return entry[slot];
        }
        stats.misses++;
        let info = entry.original || identifyNodeRegion(name);
        entry.original = info;
        const rule = rules.find((rule) => {
            if (scope !== 'group' && rule.scope !== 'all') return false;
            rule.pattern.lastIndex = 0;
            if (rule.pattern.test(name)) return true;
            rule.pattern.lastIndex = 0;
            return rule.pattern.test(stripCountryFlagEmoji(name));
        });
        if (rule)
            info = {
                ...info,
                region: rule.region,
                code: getRegionCode(rule.region),
                flag: getRegionEmoji(rule.region) || '🌍',
                source: 'override',
                matched: rule.pattern.source,
                ruleIndex: rule.index,
                conflict: false,
            };
        entry[slot] = info;
        if (cache) put(names, name, entry);
        return info;
    }
    return {
        resolve,
        resolveOriginal,
        overridesFingerprint: JSON.stringify(overrides || []),
        errors,
        stats,
        hasOverrides: rules.length > 0,
        hintsFor,
        rememberList,
        hint: (url) => hints.get(url),
        remember(url, info) {
            return put(hints, url, info);
        },
        importHints(nodeList, saved = {}) {
            const urls = String(nodeList || '')
                .trim()
                .split('\n');
            for (const [index, info] of Object.entries(saved || {}))
                if (urls[index] && typeof info?.region === 'string') put(hints, urls[index], info);
            rememberList(
                urls,
                urls.map((_url, index) =>
                    typeof saved?.[index]?.region === 'string' ? saved[index] : undefined
                )
            );
        },
        exportHints(urls, nameOf = decodeName) {
            const saved = {};
            const infos = hintsFor(urls);
            urls.forEach((url, index) => {
                const info = infos[index];
                if (
                    info &&
                    (info.source === 'override' ||
                        info.source === 'conflict' ||
                        info.source === 'destination' ||
                        info.groupRegion ||
                        info.region !== resolveOriginal(nameOf(url)).region)
                )
                    saved[index] = info;
            });
            return saved;
        },
    };
}

function decodeName(url) {
    try {
        return decodeURIComponent(url.slice(url.lastIndexOf('#') + 1));
    } catch {
        return url;
    }
}
