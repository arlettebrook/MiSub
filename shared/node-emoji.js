// 项目现有的显示约定；地区身份由 node-regions 的代码映射独立保存。
export const FLAG_DISPLAY_OVERRIDES = Object.freeze({ '🇹🇼': '🇨🇳' });

const COUNTRY_FLAG_SOURCE = '[\\u{1F1E6}-\\u{1F1FF}]{2}';
const TAG_FLAG_SOURCE = '\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2,}\\u{E007F}';
const FLAG_SOURCE = `${COUNTRY_FLAG_SOURCE}\\uFE0F?|${TAG_FLAG_SOURCE}|\\u{1F3F3}\\uFE0F?\\u200D(?:\\u{1F308}|\\u{26A7}\\uFE0F?)|[\\u{1F3F1}\\u{1F3F3}\\u{1F3F4}\\u{1F6A9}\\u{1F3C1}\\u{1F38C}\\u{1F30D}-\\u{1F310}]\\uFE0F?`;
const COUNTRY_FLAG_REGEX = new RegExp(COUNTRY_FLAG_SOURCE, 'u');
const NODE_FLAG_REGEX = new RegExp(FLAG_SOURCE, 'u');
const COUNTRY_NODE_SOURCE = `${COUNTRY_FLAG_SOURCE}\\uFE0F?|${TAG_FLAG_SOURCE}|\\u{1F30D}\\uFE0F?`;

/** 名称处理只清理国家/地区旗帜和 🌍，保留其他 Emoji。 */
export function stripCountryFlagEmoji(name) {
    if (typeof name !== 'string') return name;
    const cleaned = name.replace(new RegExp(COUNTRY_NODE_SOURCE, 'gu'), '');
    return cleaned === name ? name : cleaned.replace(/\s{2,}/g, ' ').trim();
}

export function getNationalFlagEmoji(name) {
    return typeof name === 'string'
        ? name.match(new RegExp(`${COUNTRY_FLAG_SOURCE}|${TAG_FLAG_SOURCE}`, 'u'))?.[0] || ''
        : '';
}

export function splitFlagName(name = '') {
    const parts = [];
    let offset = 0;
    for (const match of String(name).matchAll(new RegExp(COUNTRY_NODE_SOURCE, 'gu'))) {
        if (match.index > offset) parts.push({ text: name.slice(offset, match.index) });
        parts.push({ flag: match[0] });
        offset = match.index + match[0].length;
    }
    if (offset < name.length) parts.push({ text: name.slice(offset) });
    return parts;
}

export function formatNodeFlagName(name, policy = {}, info = {}) {
    const mode = policy.mode || 'auto';
    if (mode === 'preserve') return name;
    if (mode === 'remove') return stripCountryFlagEmoji(name);
    if (policy.template) {
        let globeSeen = false;
        return name
            .replace(/🌍\uFE0F?/gu, () => {
                if ((info.code && info.flag !== '🌍') || globeSeen) return '';
                globeSeen = true;
                return '🌍';
            })
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
    const existing = getNationalFlagEmoji(name);
    const flag =
        info.source === 'flag'
            ? getNationalFlagEmoji(info.matched) || existing || info.flag || '🌍'
            : info.flag || '🌍';
    const clean = stripCountryFlagEmoji(name);
    if (!clean) return flag;
    return policy.position === 'suffix' ? `${clean} ${flag}` : `${flag} ${clean}`;
}

export function getCountryFlag(name) {
    return typeof name === 'string' ? name.match(COUNTRY_FLAG_REGEX)?.[0] || '' : '';
}

export function getNodeFlagEmoji(name) {
    return typeof name === 'string' ? name.match(NODE_FLAG_REGEX)?.[0] || '' : '';
}

export function hasNodeFlagEmoji(name) {
    return Boolean(getNodeFlagEmoji(name));
}

export function stripNodeFlagEmoji(name) {
    if (typeof name !== 'string') return name;
    return name
        .replace(new RegExp(FLAG_SOURCE, 'gu'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function normalizeNodeFlagEmoji(name) {
    if (typeof name !== 'string') return name;
    return name.replace(
        new RegExp(COUNTRY_FLAG_SOURCE, 'gu'),
        (flag) => FLAG_DISPLAY_OVERRIDES[flag] || flag
    );
}
