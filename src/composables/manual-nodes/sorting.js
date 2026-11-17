import { extractNodeRegion, getRegionCode } from '../../../shared/node-regions.js';
import { isRemoteSubscriptionSource } from '../../../shared/node-source.js';
export function buildAutoSortedSubscriptions(allSubscriptions, manualNodes) {
    const subs = allSubscriptions.filter((s) => isRemoteSubscriptionSource(s));
    const nodes = [...manualNodes];

    const regionOrder = ['HK', 'TW', 'SG', 'JP', 'US', 'KR', 'GB', 'DE', 'FR', 'CA', 'AU'];
    const regionCodeForName = (name) => getRegionCode(extractNodeRegion(name)) || 'ZZ';

    nodes.sort((a, b) => {
        const regionA = regionCodeForName(a.name);
        const regionB = regionCodeForName(b.name);
        const indexA = regionOrder.indexOf(regionA);
        const indexB = regionOrder.indexOf(regionB);
        const effectiveIndexA = indexA === -1 ? Infinity : indexA;
        const effectiveIndexB = indexB === -1 ? Infinity : indexB;

        // Primary Sort: Group
        const groupA = a.group || '';
        const groupB = b.group || '';
        if (groupA !== groupB) {
            if (!groupA) return 1; // Empty group last
            if (!groupB) return -1;
            return groupA.localeCompare(groupB, 'zh-CN');
        }

        if (effectiveIndexA !== effectiveIndexB) return effectiveIndexA - effectiveIndexB;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    return [...nodes, ...subs];
}
