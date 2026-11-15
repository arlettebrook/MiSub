import { generateBuiltinClashConfig } from './builtin-clash-generator.js';
import { generateBuiltinSurgeConfig } from './builtin-surge-generator.js';
import { generateBuiltinLoonConfig } from './builtin-loon-generator.js';
import { generateBuiltinQuanxConfig } from './builtin-quanx-generator.js';
import { generateBuiltinSingboxConfig } from './builtin-singbox-generator.js';
import { generateBuiltinEgernConfig } from './builtin-egern-generator.js';
import { urlsToClashProxies } from '../../utils/url-to-clash.js';
import { assertMieruTargetSupported } from '../../../src/utils/protocols/common/mieru.js';
import { isMetaCore } from './user-agent-utils.js';

export function transformBuiltinSubscription(nodeList, targetFormat, options = {}) {
    const normalized = (targetFormat || '').toLowerCase();
    const targetKey = normalized.startsWith('surge&ver=') ? 'surge' : normalized;
    if (/mierus?:\/\//i.test(nodeList || '')) {
        assertMieruTargetSupported(
            urlsToClashProxies(String(nodeList).split('\n'), options),
            targetKey,
            options.isMeta || isMetaCore(options.userAgent, options.searchParams)
        );
    }

    switch (targetKey) {
        case 'clash':
            return generateBuiltinClashConfig(nodeList, options);
        case 'surge':
            return generateBuiltinSurgeConfig(nodeList, options);
        case 'loon':
            return generateBuiltinLoonConfig(nodeList, options);
        case 'quanx':
            return generateBuiltinQuanxConfig(nodeList, options);
        case 'singbox':
        case 'sing-box':
            return generateBuiltinSingboxConfig(nodeList, options);
        case 'egern':
            return generateBuiltinEgernConfig(nodeList, options);
        default:
            return null;
    }
}
