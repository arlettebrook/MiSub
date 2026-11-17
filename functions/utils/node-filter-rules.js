import { parseNodeInfo } from '../modules/utils/geo-utils.js';

export function createNodeFilterPredicate(sub, regionResolver) {
    const ruleText = sub.exclude;
    if (!ruleText || ruleText.trim() === '') return () => true;

    const lines = ruleText
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);

    if (lines.length === 0) return () => true;

    // 规则分割：--- 为分隔，keep: 为白名单
    const dividerIndex = lines.findIndex((line) => line === '---');
    const hasDivider = dividerIndex !== -1;

    const excludeLines = hasDivider
        ? lines.slice(0, dividerIndex)
        : lines.filter((line) => !line.toLowerCase().startsWith('keep:'));

    const keepLines = hasDivider
        ? lines.slice(dividerIndex + 1)
        : lines.filter((line) => line.toLowerCase().startsWith('keep:'));

    const excludeRules = buildRuleSet(excludeLines, false);
    const keepRules = buildRuleSet(keepLines, true);

    const whitelistOnly = !hasDivider && keepRules.hasRules;
    const shouldApplyWhitelist = (hasDivider && keepRules.hasRules) || whitelistOnly;

    return (nodeLink, regionHint) => {
        if (!whitelistOnly && nodeMatchesRules(nodeLink, excludeRules, regionResolver, regionHint))
            return false;
        return (
            !shouldApplyWhitelist ||
            nodeMatchesRules(nodeLink, keepRules, regionResolver, regionHint)
        );
    };
}

function buildRuleSet(lines, stripKeepPrefix = false) {
    const protocols = new Set();
    const patterns = [];

    for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line === '---') continue;

        if (stripKeepPrefix && line.toLowerCase().startsWith('keep:')) {
            line = line.substring('keep:'.length).trim();
        }
        if (!line) continue;

        if (line.toLowerCase().startsWith('proto:')) {
            const parts = line
                .substring('proto:'.length)
                .split(',')
                .map((p) => p.trim().toLowerCase())
                .filter(Boolean);
            parts.forEach((p) => protocols.add(p));
            continue;
        }

        patterns.push(line);
    }

    const nameRegex = buildSafeRegex(patterns);
    return {
        protocols,
        nameRegex,
        hasRules: protocols.size > 0 || Boolean(nameRegex),
    };
}

function buildSafeRegex(patterns) {
    if (!patterns.length) return null;
    try {
        return new RegExp(patterns.join('|'), 'i');
    } catch (e) {
        console.warn('Invalid include/exclude regex, skipped:', e.message);
        return null;
    }
}

function nodeMatchesRules(nodeLink, rules, regionResolver, regionHint) {
    if (!rules?.hasRules) return false;
    const nodeInfo = parseNodeInfo(nodeLink, { identifyRegion: !regionResolver && !regionHint });
    const info =
        regionHint || regionResolver?.hint(nodeLink) || regionResolver?.resolve(nodeInfo.name);
    const protocolHit = Boolean(nodeInfo.protocol && rules.protocols.has(nodeInfo.protocol));
    const nameHit = Boolean(
        rules.nameRegex &&
        (rules.nameRegex.test(nodeInfo.name || '') ||
            rules.nameRegex.test(info?.region || nodeInfo.region || '') ||
            (info?.code && rules.nameRegex.test(info.code)))
    );
    return protocolHit || nameHit;
}

export function applyFilterRules(validNodes, sub, regionResolver) {
    if (!sub.exclude?.trim()) return validNodes;
    const keep = createNodeFilterPredicate(sub, regionResolver);
    return validNodes.filter((url) => keep(url));
}
