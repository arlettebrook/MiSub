import {
    extractNodeRegion,
    normalizeRegionName,
    getRegionGroupName,
} from '../../../shared/node-regions.js';
import { stripCountryFlagEmoji } from '../../../shared/node-emoji.js';

function normalizeRegionOverrides(overrides = []) {
    if (!Array.isArray(overrides)) return [];
    return overrides
        .map((rule) => {
            if (!rule || !rule.pattern || !rule.region) return null;
            try {
                return {
                    pattern: new RegExp(rule.pattern, rule.flags || 'i'),
                    region: normalizeRegionName(String(rule.region)) || String(rule.region).trim(),
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

export function groupNodeLinesByRegion(nodes = [], options = {}) {
    const groups = new Map();
    const regionOverrides = normalizeRegionOverrides(options.regionOverrides);

    nodes.forEach((node) => {
        const tagName = node.tag || node.name;
        let region = '其他';
        const override = regionOverrides.find((rule) => {
            rule.pattern.lastIndex = 0;
            if (rule.pattern.test(tagName)) return true;
            rule.pattern.lastIndex = 0;
            return rule.pattern.test(stripCountryFlagEmoji(tagName));
        });

        // 1. 用户自定义规则优先，用于修正自动地区识别误判
        if (override) {
            region = override.region;
        } else if (node.metadata?.regionInfo?.groupRegion) {
            region = node.metadata.regionInfo.groupRegion;
        } else if (node.metadata && node.metadata.region && node.metadata.region !== '其他') {
            // 2. 使用预提取的元数据
            region = node.metadata.region;
        } else {
            region = extractNodeRegion(tagName);
        }
        const groupName = getRegionGroupName(region);

        if (!groups.has(groupName)) {
            groups.set(groupName, []);
        }
        groups.get(groupName).push(node);
    });

    const result = [];
    groups.forEach((matchedNodes, name) => {
        result.push({
            name,
            tags: matchedNodes.map((item) => item.tag || item.name),
            nodes: matchedNodes,
            count: matchedNodes.length,
            selectorTag: `${name} 选择`,
            urltestTag: `${name} 测速`,
            fallbackTag: `${name} 兜底`,
        });
    });

    return result;
}
