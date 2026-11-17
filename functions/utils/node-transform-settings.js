import { addFlagEmoji, removeFlagEmoji } from './node-utils.js';
import { parseNodeInfo } from '../modules/utils/geo-utils.js';

export {
    resolveEffectiveNodeTransform,
    resolveNodeOperators,
    resolveNodeFlagPolicy,
    resolveFlagEmojiPolicy,
} from '../../shared/node-flag-policy.js';

export function applyFlagEmojiPolicy(nodeUrls, enabled, regionResolver, onProcessed, regionHints) {
    const policy =
        typeof enabled === 'object'
            ? enabled
            : { mode: enabled ? 'auto' : 'remove', position: 'prefix' };
    return nodeUrls.map((url, index) => {
        let info = regionHints?.[index] || regionResolver?.hint(url);
        if (regionHints?.[index]) regionResolver?.remember(url, info);
        if (regionResolver && !info) {
            const name = parseNodeInfo(url, {
                normalizeFlagDisplay: false,
                identifyRegion: false,
            }).name;
            info = { ...regionResolver.resolve(name) };
            const grouped = regionResolver.resolve(name, 'group');
            if (grouped.source === 'override')
                Object.assign(info, {
                    groupRegion: grouped.region,
                    groupRuleIndex: grouped.ruleIndex,
                });
            regionResolver.remember(url, info);
        }
        const renamed =
            policy.mode === 'remove'
                ? removeFlagEmoji(url)
                : addFlagEmoji(url, { flagPolicy: policy, regionResolver });
        const resolved = regionResolver?.hint(url) || info;
        if (resolved) regionResolver.remember(renamed, resolved);
        onProcessed?.(resolved, index);
        return renamed;
    });
}
