import { describe, it, expect } from 'vitest';
import { addFlagEmoji, prependNodeName } from '../../functions/utils/node-utils.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlsToClashProxies } from '../../functions/utils/url-to-clash.js';

function buildSsrUrl(name = '台湾 1') {
    return convertClashProxyToUrl({
        name,
        type: 'ssr',
        server: 'example.com',
        port: 12345,
        protocol: 'auth_aes128_sha1',
        cipher: 'chacha20-ietf',
        obfs: 'http_simple',
        password: 'password',
        'obfs-param': 'microsoft.com',
        'protocol-param': 'user:pass',
        udp: true
    });
}

describe('node-utils', () => {
    it('prependNodeName 应在 hash 非法编码时安全回退而不是抛错', () => {
        const malformed = 'vless://uuid@example.com:443?security=tls#%E0%A4%A';

        expect(() => prependNodeName(malformed, '手动节点')).not.toThrow();

        const renamed = prependNodeName(malformed, '手动节点');
        expect(renamed).toContain('#');
        expect(decodeURIComponent(renamed.split('#')[1])).toContain('手动节点');
    });

    it('prependNodeName 应更新 SSR remarks 而不是追加会破坏解析的 hash', () => {
        const renamed = prependNodeName(buildSsrUrl('台湾 1'), '月兔');
        const proxies = urlsToClashProxies([renamed]);

        expect(renamed).not.toContain('#');
        expect(proxies).toHaveLength(1);
        expect(proxies[0].type).toBe('ssr');
        expect(proxies[0].name).toContain('月兔 - 台湾 1');
    });

    it('addFlagEmoji 应保持 SSR 节点可解析', () => {
        const withFlag = addFlagEmoji(buildSsrUrl('台湾 1'));
        const proxies = urlsToClashProxies([withFlag]);

        expect(withFlag).not.toContain('#');
        expect(proxies).toHaveLength(1);
        expect(proxies[0].type).toBe('ssr');
        expect(proxies[0].name).toContain('台湾 1');
    });
});
