import { extractNodeRegion, REGION_KEYWORDS } from '../../../shared/node-regions.js';
import { normalizeNodeFlagEmoji } from '../../../shared/node-emoji.js';
export {
    REGION_KEYWORDS,
    REGION_EMOJI,
    extractNodeRegion,
    getRegionEmoji,
    containsRegion,
} from '../../../shared/node-regions.js';
import { normalizeProxyHost, splitUriHostPort } from '../../../shared/proxy-address.js';
import { parseMieruLinks } from '../../../src/utils/protocols/common/mieru.js';
import { parseV2rayNLink } from './v2rayn-parser.js';

/**
 * 地理识别工具模块
 * 提供节点地区识别和相关功能
 */

function normalizeBase64(input) {
    let s = String(input || '')
        .trim()
        .replace(/\s+/g, '');
    if (!s) return '';
    if (s.includes('%')) {
        try {
            s = decodeURIComponent(s);
        } catch {
            // keep raw when decode fails
        }
    }
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return s;
}

function isLikelyBase64(input) {
    const s = String(input || '').trim();
    if (!s) return false;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) return false;
    return s.length >= 6;
}

function tryDecodeBase64(input) {
    if (!isLikelyBase64(input)) return null;
    try {
        return atob(normalizeBase64(input));
    } catch {
        return null;
    }
}

function parseHostPort(value) {
    let segment = String(value || '');
    if (!segment) return { server: '', port: '' };
    const cut = segment.search(/[/?#]/);
    if (cut !== -1) segment = segment.slice(0, cut);

    return splitUriHostPort(segment);
}

/**
 * 获取所有支持的地区列表
 * @returns {string[]} 支持的地区名称数组
 */
export function getSupportedRegions() {
    return Object.keys(REGION_KEYWORDS);
}

/**
 * 获取指定地区的所有关键词
 * @param {string} region - 地区名称
 * @returns {string[]} 该地区的所有关键词，如地区不存在返回空数组
 */
export function getRegionKeywords(region) {
    return REGION_KEYWORDS[region] || [];
}

/**
 * 获取节点的详细信息（协议、名称、地区等）
 * @param {string} nodeUrl - 节点URL
 * @returns {Object} 节点详细信息
 */
export function parseNodeInfo(nodeUrl, options = {}) {
    if (typeof nodeUrl === 'string' && /^v2rayn:\/\//i.test(nodeUrl)) {
        const converted = parseV2rayNLink(nodeUrl);
        if (converted) return parseNodeInfo(converted, options);
    }
    if (!nodeUrl || typeof nodeUrl !== 'string') {
        return {
            protocol: 'unknown',
            name: '未命名节点',
            region: '其他',
            url: nodeUrl,
        };
    }

    // 提取协议
    const protocolMatch = nodeUrl.match(/^(.*?):\/\//);
    let protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'unknown';
    const mieru = /^mierus?$/.test(protocol) ? parseMieruLinks(nodeUrl)[0] : null;
    if (mieru) protocol = 'mieru';

    // 提取节点名称
    let nodeName = '';
    let generatedName = false;
    const hashIndex = nodeUrl.lastIndexOf('#');
    if (hashIndex !== -1) {
        try {
            nodeName = decodeURIComponent(nodeUrl.substring(hashIndex + 1));
        } catch (e) {
            nodeName = nodeUrl.substring(hashIndex + 1);
        }
    }

    // [增强] 如果 Hash 中没有名称，尝试从 URL 参数中提取 (支持 remarks, des, remark)
    if (!nodeName) {
        const paramsMatch = nodeUrl.match(/[?&](remarks|des|remark)=([^&#]+)/);
        if (paramsMatch && paramsMatch[2]) {
            try {
                nodeName = decodeURIComponent(paramsMatch[2]);
            } catch (e) {
                nodeName = paramsMatch[2];
            }
        }
    }

    // 如果没有名称，从URL生成一个
    if (!nodeName) {
        generatedName = true;
        nodeName = '未命名节点';
    }

    // [新增] 提取服务器地址和端口
    let server = '';
    let port = '';
    if (mieru) {
        server = mieru.server;
        port = String(mieru.port || mieru['port-range'].split('-')[0]);
        if (hashIndex === -1) {
            nodeName = mieru.name;
            generatedName = false;
        }
    }

    try {
        if (mieru) {
            // Endpoint and credentials are carried in the simple Mieru query.
        } else if (protocol === 'vmess') {
            const base64Part = nodeUrl.substring(8);
            if (base64Part && !base64Part.includes('@')) {
                // 排除可能是明文的情况(虽然vmess少见)
                try {
                    // 处理 URL-safe Base64 字符
                    let safeBody = base64Part.replace(/-/g, '+').replace(/_/g, '/');
                    // 补全 Padding
                    while (safeBody.length % 4) {
                        safeBody += '=';
                    }
                    const jsonStr = atob(safeBody); // 使用 decodeURIComponent(escape(atob(safeBody))) 处理中文?
                    // 不, atob 解码后通常是 UTF-8 字节流乱码 if directly used as string for Chinese
                    // 需要用 TextDecoder
                    const binaryString = atob(safeBody);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const decodedStr = new TextDecoder('utf-8').decode(bytes);

                    const config = JSON.parse(decodedStr);
                    server = normalizeProxyHost(config.add || config.host || '');
                    port = config.port || '';
                    // [Fix] 提取名称
                    if (config.ps) {
                        nodeName = String(config.ps);
                        generatedName = false;
                    }
                } catch (e) {
                    console.debug('[GeoUtils] VMess base64 decode failed:', e);
                }
            }
        } else if (protocol === 'ss') {
            // ss://base64(user:pass@host:port)#name
            // 或者 ss://base64(user:pass)@host:port#name
            let body = nodeUrl.substring(5); // remove ss://
            const hIndex = body.indexOf('#');
            if (hIndex !== -1) body = body.substring(0, hIndex);
            const qIndex = body.indexOf('?');
            if (qIndex !== -1) body = body.substring(0, qIndex);

            const atLast = body.lastIndexOf('@');
            let serverPart = '';
            if (atLast !== -1) {
                // 明文或 SIP002 (base64 userinfo)
                serverPart = body.substring(atLast + 1);
            } else {
                const decoded = tryDecodeBase64(body);
                if (decoded && decoded.includes('@')) {
                    serverPart = decoded.substring(decoded.lastIndexOf('@') + 1);
                } else {
                    serverPart = body;
                }
            }

            const parsed = parseHostPort(serverPart);
            server = parsed.server;
            port = parsed.port;
        } else if (protocol === 'ssr') {
            // SSR 格式: ssr://base64(server:port:protocol:method:obfs:base64(password)/?params)
            // params 中包含 remarks=base64(name), obfsparam=..., protoparam=...
            try {
                let payload = nodeUrl.substring(6); // 去掉 ssr://
                // 去掉可能存在的 # fragment
                const hIdx = payload.indexOf('#');
                if (hIdx !== -1) payload = payload.substring(0, hIdx);
                // 去掉外层查询参数（不常见但防御性处理）
                const qIdx = payload.indexOf('?');
                if (qIdx !== -1) payload = payload.substring(0, qIdx);

                const decoded = tryDecodeBase64(payload);
                if (decoded) {
                    // 解析 server:port:protocol:method:obfs:password_base64/?params
                    // server 可能是 IPv6 [::1]
                    let ssrServer = '',
                        ssrPort = '';
                    const mainPayload = decoded.split('/?')[0];
                    const colonParts = mainPayload.split(':');
                    if (colonParts.length >= 6) {
                        ssrServer = normalizeProxyHost(colonParts.slice(0, -5).join(':'));
                        ssrPort = colonParts.at(-5);
                    }
                    server = ssrServer;
                    port = ssrPort;

                    // 提取 remarks 名称（SSR 名称在 Base64 编码的 remarks 参数中）
                    const slashQ = decoded.indexOf('/?');
                    const paramStart =
                        slashQ !== -1
                            ? slashQ + 2
                            : decoded.indexOf('?') !== -1
                              ? decoded.indexOf('?') + 1
                              : -1;
                    if (paramStart !== -1) {
                        const paramStr = decoded.substring(paramStart);
                        const remarksMatch = paramStr.match(/(?:^|&)remarks=([^&]*)/);
                        if (remarksMatch && remarksMatch[1]) {
                            const remarksB64 = remarksMatch[1].replace(/\s+/g, '');
                            // remarks 通常包含中文，需要 UTF-8 安全解码
                            try {
                                const normalized = normalizeBase64(remarksB64);
                                const binaryString = atob(normalized);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                const remarksDecoded = new TextDecoder('utf-8').decode(bytes);
                                if (remarksDecoded) {
                                    nodeName = remarksDecoded.trim();
                                    generatedName = false;
                                }
                            } catch (e) {
                                // Base64 解码失败，尝试使用原始值
                                const fallback = tryDecodeBase64(remarksB64);
                                if (fallback) nodeName = fallback.trim();
                            }
                        }
                    }
                }
            } catch (e) {
                console.debug('[GeoUtils] SSR decode failed:', e);
            }
        } else if (protocol === 'wireguard') {
            // WireGuard 格式: wireguard://privatekey@server:port?params#name
            let body = nodeUrl.substring('wireguard://'.length);

            // 提取名称
            const hIndex = body.indexOf('#');
            if (hIndex !== -1) {
                try {
                    nodeName = decodeURIComponent(body.substring(hIndex + 1));
                } catch (e) {
                    nodeName = body.substring(hIndex + 1);
                }
                body = body.substring(0, hIndex);
            }

            // 提取服务器和端口
            const atIndex = body.lastIndexOf('@');
            if (atIndex !== -1) {
                const serverPart = body.substring(atIndex + 1);
                const qIndex = serverPart.indexOf('?');
                const addrPart = qIndex !== -1 ? serverPart.substring(0, qIndex) : serverPart;

                ({ server, port } = parseHostPort(addrPart));
            }
        } else {
            // 通用格式: protocol://user@host:port... 或 protocol://host:port...
            // vless, trojan, hysteria2, socks5, http 等
            // 去掉 protocol://
            let body = nodeUrl.substring(nodeUrl.indexOf('://') + 3);
            const hIndex = body.indexOf('#');
            if (hIndex !== -1) body = body.substring(0, hIndex);

            const qIndex = body.indexOf('?');
            if (qIndex !== -1) body = body.substring(0, qIndex);

            const atIndex = body.lastIndexOf('@');
            let serverPart = atIndex !== -1 ? body.substring(atIndex + 1) : body;

            // [新增] 检测 Base64 编码的用户信息（某些非标准 VLESS URL）
            // 格式：vless://Base64(auto:uuid@host:port)?params
            if (atIndex === -1 && protocol === 'vless' && body.length > 20) {
                try {
                    // 尝试 Base64 解码
                    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
                    while (b64.length % 4) b64 += '=';
                    const binaryString = atob(b64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const decoded = new TextDecoder('utf-8').decode(bytes);
                    // 检查解码结果是否包含 @ 符号（形如 auto:uuid@host:port）
                    if (decoded.includes('@')) {
                        const decodedAtIndex = decoded.lastIndexOf('@');
                        serverPart = decoded.substring(decodedAtIndex + 1);
                    }
                } catch (e) {
                    // Base64 解码失败，继续使用原逻辑
                    console.debug(
                        '[GeoUtils] VLESS base64 decode attempt failed (expected for standard format)'
                    );
                }
            }

            ({ server, port } = parseHostPort(serverPart));
        }
    } catch (e) {
        console.error('Error extracting server/port:', e);
    }

    if (generatedName) nodeName = server || '未命名节点';
    // 识别地区
    const region = options.identifyRegion === false ? '其他' : extractNodeRegion(nodeName);
    if (options.normalizeFlagDisplay !== false) nodeName = normalizeNodeFlagEmoji(nodeName);

    return {
        protocol,
        name: nodeName,
        region,
        server,
        port,
        url: nodeUrl,
    };
}

/**
 * 统计节点地区分布
 * @param {Array} nodes - 节点数组
 * @returns {Object} 地区统计信息
 */
export function calculateRegionStats(nodes) {
    const stats = {};
    const total = nodes.length;

    nodes.forEach((node) => {
        const region = extractNodeRegion(node.name || '');
        stats[region] = (stats[region] || 0) + 1;
    });

    // 添加百分比信息
    for (const [region, count] of Object.entries(stats)) {
        stats[region] = {
            count,
            percentage: Math.round((count / total) * 100),
        };
    }

    return stats;
}
