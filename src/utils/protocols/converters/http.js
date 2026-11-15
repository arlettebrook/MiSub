import { formatUriHost } from '../../../../shared/proxy-address.js';

/**
 * HTTP代理转换为URL
 * 支持完整参数：认证、TLS (HTTPS)、SNI
 */
export function convertHttpToUrl(proxy) {
    try {
        if (!proxy.server || !proxy.port) {
            return null;
        }

        // 处理服务器地址 (支持 IPv6)
        const serverAddr = formatUriHost(proxy.server);

        // 用户认证
        let userinfo = '';
        if (proxy.username || proxy.password) {
            const password = proxy.password || '';
            userinfo = `${encodeURIComponent(proxy.username || '')}:${encodeURIComponent(password)}@`;
        }

        // 协议类型 (http/https)
        const useTls = String(proxy.type).toLowerCase() === 'https' || proxy.tls === true;
        const protocol = useTls ? 'https' : 'http';
        let url = `${protocol}://${userinfo}${serverAddr}:${proxy.port}`;

        const params = new URLSearchParams();

        // TLS 配置
        if (useTls) {
            // SNI
            if (proxy.sni || proxy.servername) {
                params.set('sni', proxy.sni || proxy.servername);
            }

            // Fingerprint
            if (proxy['client-fingerprint'] || proxy.fingerprint) {
                params.set('fp', proxy['client-fingerprint'] || proxy.fingerprint);
            }

            // 跳过证书验证
            const skipCertVerify = proxy['skip-cert-verify'] ?? proxy.skipCertVerify;
            if (skipCertVerify !== undefined) {
                params.set('allowInsecure', skipCertVerify ? '1' : '0');
            }

            // ALPN
            if (proxy.alpn) {
                const alpn = Array.isArray(proxy.alpn) ? proxy.alpn.join(',') : proxy.alpn;
                params.set('alpn', alpn);
            }
        }
        if (proxy['dialer-proxy']) params.set('dp', proxy['dialer-proxy']);

        // 自定义 Headers
        if (proxy.headers) {
            for (const [key, value] of Object.entries(proxy.headers)) {
                params.set(`header-${key}`, value);
            }
        }

        // 添加参数
        const paramsStr = params.toString();
        if (paramsStr) {
            url += `?${paramsStr}`;
        }

        // Fragment (节点名称)
        url += `#${encodeURIComponent(proxy.name || `${protocol.toUpperCase()}-${proxy.server}`)}`;

        return url;
    } catch (e) {
        console.error('HTTP转换失败:', e);
        return null;
    }
}
