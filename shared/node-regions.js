import {
    FLAG_DISPLAY_OVERRIDES,
    getCountryFlag,
    getNodeFlagEmoji,
    normalizeNodeFlagEmoji,
} from './node-emoji.js';
import { COUNTRY_REGISTRY } from './country-registry.js';

function countryCodeFromFlag(flag) {
    return [...flag]
        .map((char) => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 65))
        .join('');
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const REGION_KEYWORDS = {
    香港: ['HK', 'HKG', 'HKT', '香港', 'Hong Kong', 'HongKong'],
    台湾: [
        'TW',
        'TPE',
        '台湾',
        '臺灣',
        '台灣',
        '台北',
        '臺北',
        '台中',
        '臺中',
        '台南',
        '臺南',
        '高雄',
        '新竹',
        '桃园',
        '桃園',
        'Taiwan',
        'Taipei',
        'Kaohsiung',
        'Taichung',
        'Tainan',
        'Hsinchu',
        'Taoyuan',
    ],
    新加坡: ['SG', 'SIN', '新加坡', 'Singapore', '狮城'],
    日本: [
        'JP',
        'JPN',
        'NRT',
        'HND',
        'KIX',
        'FUK',
        '东京',
        '大阪',
        '日本',
        'Japan',
        'Tokyo',
        'Osaka',
        'Fukuoka',
        'Yokohama',
    ],
    美国: [
        'US',
        'USA',
        'LAX',
        'SFO',
        'SEA',
        'JFK',
        'NYC',
        'ORD',
        'DFW',
        'IAD',
        '美国',
        'United States',
        'America',
        'Los Angeles',
        'New York',
        'San Francisco',
        'Seattle',
        'Chicago',
        '洛杉矶',
        '纽约',
        '旧金山',
        '西雅图',
        '芝加哥',
    ],
    韩国: ['KR', 'KOR', 'ICN', '韩国', '首尔', 'Korea', 'Seoul'],
    英国: [
        'UK',
        'GB',
        'LHR',
        'LGW',
        'LON',
        '英国',
        'Britain',
        'United Kingdom',
        'London',
        'Manchester',
        '伦敦',
        '曼彻斯特',
    ],
    德国: [
        'DE',
        'DEU',
        'FRA',
        'MUC',
        '德国',
        'Germany',
        'Frankfurt',
        'Berlin',
        'Munich',
        '法兰克福',
        '柏林',
        '慕尼黑',
    ],
    法国: [
        'FR',
        'CDG',
        'ORY',
        '法国',
        'France',
        'Paris',
        'Lyon',
        'Marseille',
        '巴黎',
        '里昂',
        '马赛',
    ],
    加拿大: [
        'CA',
        'CAN',
        'YVR',
        'YYZ',
        '加拿大',
        'Canada',
        'Toronto',
        'Vancouver',
        'Montreal',
        '多伦多',
        '温哥华',
        '蒙特利尔',
    ],
    澳大利亚: [
        'AU',
        'AUS',
        'SYD',
        'MEL',
        'BNE',
        'PER',
        '澳大利亚',
        'Australia',
        'Sydney',
        'Melbourne',
        'Brisbane',
        'Perth',
        '悉尼',
        '墨尔本',
        '布里斯班',
        '珀斯',
    ],
    荷兰: [
        'NL',
        'NLD',
        'AMS',
        '荷兰',
        'Netherlands',
        'Amsterdam',
        'Rotterdam',
        '阿姆斯特丹',
        '鹿特丹',
    ],
    俄罗斯: [
        'RU',
        'RUS',
        'SVO',
        'DME',
        '俄罗斯',
        'Russia',
        'Moscow',
        'Saint Petersburg',
        '莫斯科',
        '圣彼得堡',
    ],
    印度: [
        'IN',
        'IND',
        'BOM',
        'DEL',
        'BLR',
        '印度',
        'India',
        'Mumbai',
        'Delhi',
        'Bangalore',
        '孟买',
        '德里',
        '班加罗尔',
    ],
    土耳其: ['TR', 'TUR', 'IST', '土耳其', 'Turkey', 'Istanbul', 'Ankara', '伊斯坦布尔', '安卡拉'],
    孟加拉: ['BD', 'BGD', 'DAC', '孟加拉', '孟加拉国', 'Bangladesh', 'Dhaka', '达卡'],
    巴基斯坦: [
        'PK',
        'PAK',
        'ISB',
        'LHE',
        '巴基斯坦',
        'Pakistan',
        'Islamabad',
        'Lahore',
        '伊斯兰堡',
        '拉合尔',
    ],
    马来西亚: ['MY', 'MYS', 'KUL', '马来西亚', 'Malaysia', 'Kuala Lumpur', '吉隆坡'],
    泰国: ['TH', 'THA', 'BKK', '泰国', 'Thailand', 'Bangkok', 'Pattaya', '曼谷', '芭提雅'],
    越南: [
        'VN',
        'VNM',
        'SGN',
        'HAN',
        '越南',
        'Vietnam',
        'Ho Chi Minh City',
        'Hanoi',
        '胡志明市',
        '河内',
    ],
    菲律宾: [
        'PH',
        'PHL',
        'MNL',
        'CEB',
        '菲律宾',
        'Philippines',
        'Manila',
        'Cebu',
        '马尼拉',
        '宿务',
    ],
    印尼: [
        'ID',
        'IDN',
        'CGK',
        '印尼',
        '印度尼西亚',
        'Indonesia',
        'Jakarta',
        'Surabaya',
        'Bandung',
        '雅加达',
        '泗水',
        '万隆',
    ],
    文莱: ['BN', 'BRN', 'BWN', '文莱', 'Brunei', 'Bandar Seri Begawan', '斯里巴加湾市'],
    柬埔寨: ['KH', 'KHM', 'PNH', '柬埔寨', 'Cambodia', 'Phnom Penh', '金边'],
    老挝: ['LA', 'LAO', 'VTE', '老挝', 'Laos', 'Vientiane', '万象'],
    缅甸: ['MM', 'MMR', 'RGN', '缅甸', 'Myanmar', 'Burma', 'Yangon', 'Rangoon', '仰光'],
    瑞士: [
        'CH',
        'CHE',
        'ZRH',
        'GVA',
        '瑞士',
        'Switzerland',
        'Zurich',
        'Geneva',
        '苏黎世',
        '日内瓦',
    ],
    意大利: [
        'IT',
        'ITA',
        'FCO',
        'MXP',
        '意大利',
        'Italy',
        'Rome',
        'Milan',
        'Naples',
        '罗马',
        '米兰',
        '那不勒斯',
    ],
    西班牙: [
        'ES',
        'ESP',
        'MAD',
        'BCN',
        '西班牙',
        'Spain',
        'Madrid',
        'Barcelona',
        '马德里',
        '巴塞罗那',
    ],
    巴西: [
        'BR',
        'BRA',
        'GRU',
        'GIG',
        '巴西',
        'Brazil',
        'São Paulo',
        'Rio de Janeiro',
        '圣保罗',
        '里约',
    ],
    阿根廷: ['AR', 'ARG', 'EZE', '阿根廷', 'Argentina', 'Buenos Aires', '布宜诺斯艾利斯'],
    墨西哥: ['MX', 'MEX', '墨西哥', 'Mexico', 'Mexico City', '墨西哥城'],
    哥伦比亚: ['CO', 'COL', 'BOG', '哥伦比亚', 'Colombia', 'Bogota', 'Bogotá', '波哥大'],
    秘鲁: ['PE', 'PER', 'LIM', '秘鲁', 'Peru', 'Lima', '利马'],
    南非: [
        'ZA',
        'ZAF',
        'JNB',
        'CPT',
        '南非',
        'South Africa',
        'Johannesburg',
        'Cape Town',
        '约翰内斯堡',
        '开普敦',
    ],
    埃及: ['EG', 'EGY', 'CAI', '埃及', 'Egypt', 'Cairo', '开罗'],
    以色列: [
        'IL',
        'ISR',
        'TLV',
        '以色列',
        'Israel',
        'Tel Aviv',
        'Jerusalem',
        '特拉维夫',
        '耶路撒冷',
    ],
    阿联酋: [
        'AE',
        'ARE',
        'DXB',
        'AUH',
        '阿联酋',
        'UAE',
        'Dubai',
        'Abu Dhabi',
        'Sharjah',
        '迪拜',
        '阿布扎比',
        '沙迦',
    ],
    阿曼: ['OM', 'OMN', 'MCT', '阿曼', 'Oman', 'Muscat', '马斯喀特'],
    沙特: ['SA', 'SAU', 'RUH', 'JED', '沙特', 'Saudi Arabia', 'Riyadh', 'Jeddah', '利雅得', '吉达'],
    波兰: ['PL', 'POL', 'WAW', '波兰', 'Poland', 'Warsaw', 'Krakow', '华沙', '克拉科夫'],
    捷克: ['CZ', 'CZE', 'PRG', '捷克', 'Czech Republic', 'Prague', '布拉格'],
    匈牙利: ['HU', 'HUN', 'BUD', '匈牙利', 'Hungary', 'Budapest', '布达佩斯'],
    罗马尼亚: ['RO', 'ROU', 'OTP', '罗马尼亚', 'Romania', 'Bucharest', '布加勒斯特'],
    保加利亚: ['BG', 'BGR', 'SOF', '保加利亚', 'Bulgaria', 'Sofia', '索非亚'],
    希腊: ['GR', 'GRC', 'ATH', '希腊', 'Greece', 'Athens', 'Thessaloniki', '雅典', '塞萨洛尼基'],
    葡萄牙: ['PT', 'PRT', 'LIS', '葡萄牙', 'Portugal', 'Lisbon', 'Porto', '里斯本', '波尔图'],
    瑞典: ['SE', 'SWE', 'ARN', '瑞典', 'Sweden', 'Stockholm', 'Gothenburg', '斯德哥尔摩', '哥德堡'],
    挪威: ['NO', 'NOR', 'OSL', '挪威', 'Norway', 'Oslo', 'Bergen', '奥斯陆', '卑尔根'],
    丹麦: ['DK', 'DNK', 'CPH', '丹麦', 'Denmark', 'Copenhagen', 'Aarhus', '哥本哈根', '奥胡斯'],
    芬兰: ['FI', 'FIN', 'HEL', '芬兰', 'Finland', 'Helsinki', '赫尔辛基'],
    奥地利: ['AT', 'AUT', 'VIE', '奥地利', 'Austria', 'Vienna', 'Salzburg', '维也纳', '萨尔茨堡'],
    爱尔兰: ['IE', 'IRL', 'DUB', '爱尔兰', 'Ireland', 'Dublin', '都柏林'],
    冰岛: ['IS', 'ISL', 'KEF', '冰岛', 'Iceland', 'Reykjavik', '雷克雅未克'],
    卢森堡: ['LU', 'LUX', '卢森堡', 'Luxembourg', 'Luxembourg City', '卢森堡市'],
    马耳他: ['MT', 'MLT', 'MLA', '马耳他', 'Malta', 'Valletta', '瓦莱塔'],
    斯洛伐克: ['SK', 'SVK', 'BTS', '斯洛伐克', 'Slovakia', 'Bratislava', '布拉迪斯拉发'],
    斯洛文尼亚: ['SI', 'SVN', 'LJU', '斯洛文尼亚', 'Slovenia', 'Ljubljana', '卢布尔雅那'],
    克罗地亚: ['HR', 'HRV', 'ZAG', '克罗地亚', 'Croatia', 'Zagreb', '萨格勒布'],
    拉脱维亚: ['LV', 'LVA', 'RIX', '拉脱维亚', 'Latvia', 'Riga', '里加'],
    立陶宛: ['LT', 'LTU', 'VNO', '立陶宛', 'Lithuania', 'Vilnius', '维尔纽斯'],
    爱沙尼亚: ['EE', 'EST', 'TLL', '爱沙尼亚', 'Estonia', 'Tallinn', '塔林'],
    塞浦路斯: ['CY', 'CYP', 'LCA', '塞浦路斯', 'Cyprus', 'Nicosia', '尼科西亚'],
    列支敦士登: ['LI', 'LIE', '列支敦士登', 'Liechtenstein', 'Vaduz', '瓦杜兹'],
    阿尔巴尼亚: ['AL', 'ALB', 'TIA', '阿尔巴尼亚', 'Albania', 'Tirana', '地拉那'],
    安道尔: ['AD', 'AND', '安道尔', 'Andorra', 'Andorra la Vella', '安道尔城'],
    白俄罗斯: ['BY', 'BLR', 'MSQ', '白俄罗斯', 'Belarus', 'Minsk', '明斯克'],
    波黑: [
        'BA',
        'BIH',
        'SJJ',
        '波黑',
        '波斯尼亚',
        'Bosnia',
        'Bosnia and Herzegovina',
        'Sarajevo',
        '萨拉热窝',
    ],
    摩尔多瓦: ['MD', 'MDA', 'KIV', '摩尔多瓦', 'Moldova', 'Chisinau', 'Chișinău', '基希讷乌'],
    摩纳哥: ['MC', 'MCO', '摩纳哥', 'Monaco', 'Monte Carlo', '蒙特卡洛'],
    黑山: ['ME', 'MNE', 'TGD', '黑山', 'Montenegro', 'Podgorica', '波德戈里察'],
    北马其顿: [
        'MK',
        'MKD',
        'SKP',
        '北马其顿',
        'North Macedonia',
        'Macedonia',
        'Skopje',
        '斯科普里',
    ],
    塞尔维亚: ['RS', 'SRB', 'BEG', '塞尔维亚', 'Serbia', 'Belgrade', '贝尔格莱德'],
    乌克兰: ['UA', 'UKR', 'KBP', '乌克兰', 'Ukraine', 'Kyiv', 'Kiev', '基辅'],
    科索沃: ['XK', 'XKS', 'PRN', '科索沃', 'Kosovo', 'Pristina', '普里什蒂纳'],
    圣马力诺: ['SM', 'SMR', '圣马力诺', 'San Marino'],
    梵蒂冈: ['VA', 'VAT', '梵蒂冈', 'Vatican', 'Vatican City', '梵蒂冈城'],
    格鲁吉亚: ['GE', 'GEO', 'TBS', '格鲁吉亚', 'Georgia', 'Tbilisi', '第比利斯'],
    亚美尼亚: ['AM', 'ARM', 'EVN', '亚美尼亚', 'Armenia', 'Yerevan', '埃里温'],
    阿塞拜疆: ['AZ', 'AZE', 'GYD', '阿塞拜疆', 'Azerbaijan', 'Baku', '巴库'],
    比利时: [
        'BE',
        'BEL',
        'BRU',
        '比利时',
        'Belgium',
        'Brussels',
        '安特卫普',
        '布鲁塞尔',
        'Antwerp',
    ],
    中国: [
        'CN',
        'CHN',
        '中国',
        '中國',
        '大陆',
        '大陸',
        '内地',
        'China',
        '北京',
        '上海',
        '深圳',
        '广州',
        '廣州',
        '杭州',
        'Beijing',
        'Shanghai',
        'Shenzhen',
        'Guangzhou',
        'PEK',
        'PVG',
        'SZX',
    ],
    澳门: ['MO', 'MAC', '澳门', '澳門', 'Macau', 'Macao'],
    新西兰: ['NZ', 'NZL', '新西兰', '紐西蘭', 'New Zealand'],
};

export const REGION_EMOJI = {
    香港: '🇭🇰',
    台湾: FLAG_DISPLAY_OVERRIDES['🇹🇼'],
    新加坡: '🇸🇬',
    日本: '🇯🇵',
    美国: '🇺🇸',
    韩国: '🇰🇷',
    英国: '🇬🇧',
    德国: '🇩🇪',
    法国: '🇫🇷',
    加拿大: '🇨🇦',
    澳大利亚: '🇦🇺',
    荷兰: '🇳🇱',
    俄罗斯: '🇷🇺',
    印度: '🇮🇳',
    土耳其: '🇹🇷',
    孟加拉: '🇧🇩',
    巴基斯坦: '🇵🇰',
    马来西亚: '🇲🇾',
    泰国: '🇹🇭',
    越南: '🇻🇳',
    菲律宾: '🇵🇭',
    印尼: '🇮🇩',
    文莱: '🇧🇳',
    柬埔寨: '🇰🇭',
    老挝: '🇱🇦',
    缅甸: '🇲🇲',
    瑞士: '🇨🇭',
    意大利: '🇮🇹',
    西班牙: '🇪🇸',
    巴西: '🇧🇷',
    阿根廷: '🇦🇷',
    墨西哥: '🇲🇽',
    哥伦比亚: '🇨🇴',
    秘鲁: '🇵🇪',
    南非: '🇿🇦',
    埃及: '🇪🇬',
    以色列: '🇮🇱',
    阿联酋: '🇦🇪',
    阿曼: '🇴🇲',
    沙特: '🇸🇦',
    波兰: '🇵🇱',
    捷克: '🇨🇿',
    匈牙利: '🇭🇺',
    罗马尼亚: '🇷🇴',
    希腊: '🇬🇷',
    葡萄牙: '🇵🇹',
    瑞典: '🇸🇪',
    挪威: '🇳🇴',
    丹麦: '🇩🇰',
    芬兰: '🇫🇮',
    奥地利: '🇦🇹',
    爱尔兰: '🇮🇪',
    冰岛: '🇮🇸',
    卢森堡: '🇱🇺',
    马耳他: '🇲🇹',
    斯洛伐克: '🇸🇰',
    斯洛文尼亚: '🇸🇮',
    克罗地亚: '🇭🇷',
    拉脱维亚: '🇱🇻',
    立陶宛: '🇱🇹',
    爱沙尼亚: '🇪🇪',
    塞浦路斯: '🇨🇾',
    列支敦士登: '🇱🇮',
    阿尔巴尼亚: '🇦🇱',
    安道尔: '🇦🇩',
    白俄罗斯: '🇧🇾',
    波黑: '🇧🇦',
    摩尔多瓦: '🇲🇩',
    摩纳哥: '🇲🇨',
    黑山: '🇲🇪',
    北马其顿: '🇲🇰',
    塞尔维亚: '🇷🇸',
    乌克兰: '🇺🇦',
    科索沃: '🇽🇰',
    圣马力诺: '🇸🇲',
    梵蒂冈: '🇻🇦',
    格鲁吉亚: '🇬🇪',
    亚美尼亚: '🇦🇲',
    阿塞拜疆: '🇦🇿',
    比利时: '🇧🇪',
    其他: '🌍',
    中国: '🇨🇳',
    澳门: '🇲🇴',
    新西兰: '🇳🇿',
};

// 兼容分组简称和前端已有的繁体名称，单个汉字使用边界约束。
const REGION_NAME_ALIASES = {
    香港: ['港'],
    台湾: ['台', '臺'],
    新加坡: ['新'],
    日本: ['日'],
    美国: ['美', '美國'],
    韩国: ['韩', '韓', '韓國'],
    英国: ['英', 'England', '英國'],
    德国: ['德', '德國'],
    法国: ['法', '法國'],
    澳大利亚: ['澳', '澳洲', '澳大利亞'],
    俄罗斯: ['俄羅斯'],
    荷兰: ['荷蘭'],
    马来西亚: ['馬來西亞'],
    泰国: ['泰國'],
    菲律宾: ['菲律賓'],
    印尼: ['印度尼西亚', '印度尼西亞'],
    孟加拉: ['孟加拉國'],
    阿联酋: ['阿聯酋'],
    罗马尼亚: ['羅馬尼亞'],
    乌克兰: ['烏克蘭'],
    波兰: ['波蘭'],
    丹麦: ['丹麥'],
    芬兰: ['芬蘭'],
    比利时: ['比利時'],
    奥地利: ['奧地利'],
    爱尔兰: ['愛爾蘭'],
};
for (const [region, aliases] of Object.entries(REGION_NAME_ALIASES)) {
    REGION_KEYWORDS[region].push(...aliases);
}

const existingCodes = new Map(
    Object.entries(REGION_EMOJI)
        .filter(([, flag]) => getCountryFlag(flag))
        .map(([region, flag]) => [region === '台湾' ? 'TW' : countryCodeFromFlag(flag), region])
);
for (const country of COUNTRY_REGISTRY) {
    const region = existingCodes.get(country.code) || country.name;
    const keywords = (REGION_KEYWORDS[region] ||= []);
    for (const alias of [country.code, country.name, country.english])
        if (!keywords.includes(alias)) keywords.push(alias);
    REGION_EMOJI[region] ||= [...country.code]
        .map((letter) => String.fromCodePoint(letter.charCodeAt(0) - 65 + 0x1f1e6))
        .join('');
}

// 完整地名优先于其子串，例如“印度尼西亚”不能被“印度”提前匹配。
const REGION_LONG_NAMES = Object.entries(REGION_KEYWORDS).flatMap(([region, keywords]) =>
    keywords
        .filter((keyword) => keyword.length > 1 && /\p{Script=Han}/u.test(keyword))
        .map((keyword) => ({ region, keyword }))
);
const REGION_KEYWORD_EXCLUSIONS = new Map();
for (const { region, keyword } of REGION_LONG_NAMES) {
    const longer = REGION_LONG_NAMES.filter(
        (other) =>
            other.region !== region &&
            other.keyword.length > keyword.length &&
            other.keyword.includes(keyword)
    ).map((other) => other.keyword);
    if (longer.length) REGION_KEYWORD_EXCLUSIONS.set(keyword, longer);
}

// 地区代码独立于显示旗帜，TW 和 CN 始终保留不同的身份。
export const REGION_CODES = Object.fromEntries(
    Object.entries(REGION_EMOJI)
        .filter(([, flag]) => getCountryFlag(flag))
        .map(([region, flag]) => [region, region === '台湾' ? 'TW' : countryCodeFromFlag(flag)])
);
const REGIONS_BY_CODE = Object.fromEntries(
    Object.entries(REGION_CODES).map(([region, code]) => [code, region])
);
REGIONS_BY_CODE.UK = '英国';

const REGION_ALIASES = new Map();
const REGION_MATCHERS = new Map();
const CODE_WORDS = new Set([
    'as',
    'at',
    'be',
    'by',
    'do',
    'in',
    'is',
    'it',
    'me',
    'my',
    'no',
    'to',
    'am',
    'can',
]);
const SERVICE_LABELS = new Set(['ss', 'ws', 'cf', 'ai']);
for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    for (const alias of [region, REGION_CODES[region], ...keywords]) {
        if (alias) REGION_ALIASES.set(alias.toLowerCase(), region);
    }
    REGION_MATCHERS.set(
        region,
        keywords.map((keyword) => {
            const value = keyword.toLowerCase();
            if (SERVICE_LABELS.has(value)) return /(?!)/;
            if (value.length <= 3 && /^[a-z]+$/.test(value)) {
                return new RegExp(
                    `(?:^|[^a-zA-Z])${escapeRegex(CODE_WORDS.has(value) ? value.toUpperCase() : value)}(?=$|[^a-zA-Z])`,
                    CODE_WORDS.has(value) ? '' : 'i'
                );
            }
            if (/^\p{Script=Han}$/u.test(value)) {
                return new RegExp(`(?:^|[^\\p{L}])${escapeRegex(value)}(?=$|[^\\p{L}])`, 'u');
            }
            return value;
        })
    );
}

const PHRASE_ALIASES = [...REGION_ALIASES.entries()]
    .filter(([alias]) => /[a-z]/i.test(alias) && /[\s-]/.test(alias))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([alias, region]) => ({
        region,
        alias,
        pattern: new RegExp(
            `(?:^|[^a-z])${alias
                .split(/[\s-]+/)
                .map(escapeRegex)
                .join('[\\s_-]+')}(?=$|[^a-z])`,
            'i'
        ),
    }));

export function normalizeRegionName(region) {
    if (typeof region !== 'string') return '';
    const normalized = region.trim();
    const flag = getCountryFlag(normalized);
    return (
        REGION_ALIASES.get(normalized.toLowerCase()) ||
        (normalized === flag ? REGIONS_BY_CODE[countryCodeFromFlag(flag)] : '') ||
        (normalized === '其他' ? '其他' : '')
    );
}

export function getRegionCode(region) {
    return REGION_CODES[normalizeRegionName(region)] || '';
}

function matchesRegionKeywords(name, region) {
    const value = name.toLowerCase();
    return (REGION_MATCHERS.get(region) || []).some((matcher) => {
        if (typeof matcher !== 'string') return matcher.test(name);
        return (
            value.includes(matcher) &&
            !(REGION_KEYWORD_EXCLUSIONS.get(matcher) || []).some((longer) => value.includes(longer))
        );
    });
}

function identifySingleNodeRegion(nodeName) {
    const result = (region, source, matched = '') => ({
        region,
        code: REGION_CODES[region] || '',
        flag: REGION_EMOJI[region] || '🌍',
        source,
        matched,
    });
    if (typeof nodeName !== 'string' || !nodeName) return result('其他', 'unknown');
    const flagCode = countryCodeFromFlag(getCountryFlag(nodeName));
    // CN 同时用于显示台湾节点，显式的台湾名称/代码用于消除歧义。
    if (flagCode === 'CN')
        return result(
            matchesRegionKeywords(nodeName, '台湾') ? '台湾' : '中国',
            'flag',
            getCountryFlag(nodeName)
        );
    if (REGIONS_BY_CODE[flagCode])
        return result(REGIONS_BY_CODE[flagCode], 'flag', getCountryFlag(nodeName));
    if (
        (nodeName.includes('::') || (nodeName.match(/:/g) || []).length >= 3) &&
        /^[\da-f:.\[\]]+$/i.test(nodeName)
    )
        return result('其他', 'unknown');
    const tagFlag = getNodeFlagEmoji(nodeName);
    if (tagFlag.startsWith('🏴') && tagFlag.endsWith('\u{E007F}')) {
        const tag = [...tagFlag]
            .slice(1, -1)
            .map((char) => String.fromCharCode(char.codePointAt(0) - 0xe0000))
            .join('');
        if (['gbeng', 'gbsct', 'gbwls'].includes(tag)) return result('英国', 'flag', tagFlag);
    }
    for (const phrase of PHRASE_ALIASES)
        if (phrase.pattern.test(nodeName)) return result(phrase.region, 'keyword', phrase.alias);
    // 完整地名和明确代码优先，避免把英语 to、my、in 等词误认为国家。
    const tokens = nodeName.match(/[a-z]+\d*|[\p{Script=Han}]+/giu) || [];
    for (const token of tokens) {
        const word = token.toLowerCase();
        const alias = /^[a-z]{2,3}\d+$/.test(word) ? word.replace(/\d+$/, '') : word;
        const region = REGION_ALIASES.get(alias);
        if (SERVICE_LABELS.has(alias)) continue;
        if (
            region &&
            (alias.length > 3 ||
                /\p{Script=Han}/u.test(alias) ||
                token === token.toUpperCase() ||
                /\d/.test(token))
        )
            return result(region, /^[a-z]{2,3}$/.test(alias) ? 'code' : 'keyword', token);
    }
    for (const token of tokens) {
        const alias = token.toLowerCase();
        if (REGION_ALIASES.has(alias) && !CODE_WORDS.has(alias) && !SERVICE_LABELS.has(alias))
            return result(REGION_ALIASES.get(alias), 'code', token);
    }
    for (const region of Object.keys(REGION_KEYWORDS)) {
        if (matchesRegionKeywords(nodeName, region))
            return result(
                region,
                'keyword',
                REGION_KEYWORDS[region].find((keyword) =>
                    nodeName.toLowerCase().includes(keyword.toLowerCase())
                ) || region
            );
    }
    return result('其他', 'unknown');
}

const HAN_REGION_ALIASES = new RegExp(
    [...REGION_ALIASES.keys()]
        .filter((alias) => alias.length > 1 && /^[\p{Script=Han}]+$/u.test(alias))
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|'),
    'gu'
);
const DESTINATION_MARKER =
    /(?:->|=>|→|⇒|➡\uFE0F?|➜|至|到|落地|出口|\b(?:exit|egress|destination)\b)\s*[:：]?/giu;

/** 收集独立国家证据；完整复合地名会遮蔽其中的短地名。 */
export function getNodeRegionCandidates(name) {
    if (typeof name !== 'string' || !name) return [];
    if (/^[\da-f:.\[\]]+$/i.test(name) && name.includes(':')) return [];
    const evidence = [];
    const add = (region, source, matched, index) => {
        if (region && region !== '其他')
            evidence.push({
                region,
                code: REGION_CODES[region] || '',
                flag: REGION_EMOJI[region] || '🌍',
                source,
                matched,
                index,
            });
    };
    for (const match of name.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)) {
        const code = countryCodeFromFlag(match[0]);
        add(
            code === 'CN' && matchesRegionKeywords(name, '台湾') ? '台湾' : REGIONS_BY_CODE[code],
            'flag',
            match[0],
            match.index
        );
    }
    for (const match of name.matchAll(/\u{1F3F4}[\u{E0061}-\u{E007A}]{2,}\u{E007F}/gu)) {
        const info = identifySingleNodeRegion(match[0]);
        add(info.region, 'flag', match[0], match.index);
    }
    const phrases = [];
    for (const phrase of PHRASE_ALIASES) {
        const match = phrase.pattern.exec(name);
        if (!match) continue;
        const start = match.index,
            end = start + match[0].length;
        if (phrases.some((span) => start >= span.start && end <= span.end)) continue;
        phrases.push({ start, end });
        add(phrase.region, 'keyword', phrase.alias, start);
    }
    for (const match of name.matchAll(HAN_REGION_ALIASES))
        add(REGION_ALIASES.get(match[0]), 'keyword', match[0], match.index);
    for (const match of name.matchAll(/[a-z]+\d*|[\p{Script=Han}]+/giu)) {
        if (phrases.some((span) => match.index >= span.start && match.index < span.end)) continue;
        const token = match[0],
            word = token.toLowerCase();
        const alias = /^[a-z]{2,3}\d+$/.test(word) ? word.replace(/\d+$/, '') : word;
        if (
            SERVICE_LABELS.has(alias) ||
            (CODE_WORDS.has(alias) && token !== token.toUpperCase() && !/\d/.test(token))
        )
            continue;
        add(
            REGION_ALIASES.get(alias),
            /^[a-z]{2,3}$/.test(alias) ? 'code' : 'keyword',
            token,
            match.index
        );
    }
    if (!evidence.length) {
        const single = identifySingleNodeRegion(name);
        add(single.region, single.source, single.matched, 0);
    }
    return [
        ...new Map(
            evidence.sort((a, b) => a.index - b.index).map((item) => [item.region, item])
        ).values(),
    ];
}

export function identifyNodeRegion(name) {
    const single = identifySingleNodeRegion(name);
    const candidates = getNodeRegionCandidates(name);
    if (candidates.length <= 1)
        return single.region === '其他' && candidates[0]?.source === 'flag'
            ? { ...candidates[0] }
            : single;
    const markers = [...name.matchAll(DESTINATION_MARKER)];
    if (markers.length) {
        const marker = markers.at(-1);
        const destination = getNodeRegionCandidates(name.slice(marker.index + marker[0].length));
        if (destination.length === 1)
            return {
                ...destination[0],
                source: 'destination',
                matched: name.slice(marker.index),
                candidates,
                conflict: false,
            };
    }
    return {
        region: '其他',
        code: '',
        flag: '🌍',
        source: 'conflict',
        matched: name,
        candidates,
        conflict: true,
    };
}

export function extractNodeRegion(nodeName) {
    return identifyNodeRegion(nodeName).region;
}

export function getRegionEmoji(region) {
    const normalized = normalizeRegionName(region);
    return REGION_EMOJI[normalized] || (region === '其他' || !region ? '🌍' : '');
}

/** 展示未知地区时仍使用完整旗帜序列或地球符号。 */
export function getRegionDisplayEmoji(region) {
    return getRegionEmoji(region) || normalizeNodeFlagEmoji(getNodeFlagEmoji(region)) || '🌍';
}

export function containsRegion(nodeName, region) {
    const normalized = normalizeRegionName(region);
    if (typeof nodeName !== 'string' || !normalized) return false;
    return (
        extractNodeRegion(nodeName) === normalized || matchesRegionKeywords(nodeName, normalized)
    );
}

const REGION_GROUP_LABELS = { 新加坡: '狮城节点', 澳大利亚: '澳洲节点', 俄罗斯: '俄国节点' };
export function getRegionGroupName(region) {
    const normalized = normalizeRegionName(region) || region || '其他';
    return `${getRegionEmoji(normalized) || '🌍'} ${REGION_GROUP_LABELS[normalized] || `${normalized}节点`}`;
}
