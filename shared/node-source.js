const NODE_SCHEME =
    /^(ss|ssr|vmess|vless|trojan|hysteria2?|hy|hy2|tuic|anytls|socks5|socks|snell|wireguard|naive\+https?|naive\+quic):\/\//i;
const HTTP_PROXY_PARAMS = new Set([
    'proxy',
    'sni',
    'peer',
    'fp',
    'alpn',
    'allowInsecure',
    'insecure',
    'dp',
]);

export function parseHttpProxyEndpoint(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
    const text = value.trim();
    try {
        const url = new URL(text);
        if (!url.hostname || (url.pathname !== '/' && url.pathname !== '')) return null;
        if (
            [...url.searchParams.keys()].some(
                (key) => !HTTP_PROXY_PARAMS.has(key) && !key.startsWith('header-')
            )
        )
            return null;
        const authority = text.match(/^https?:\/\/([^/?#]*)/i)?.[1] || '';
        const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
        const explicitPort = hostPort.match(/(?:\]|[^:]):(\d+)$/)?.[1];
        const port = explicitPort ? Number(explicitPort) : url.protocol === 'https:' ? 443 : 80;
        if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
        return { url, port, explicitPort: Boolean(explicitPort) };
    } catch {
        return null;
    }
}

export function isHttpProxyUrl(value) {
    const endpoint = parseHttpProxyEndpoint(value);
    if (!endpoint) return false;
    const { url, explicitPort } = endpoint;
    // A port alone cannot distinguish a subscription from an HTTP proxy.
    // Explicit proxy imports add a marker; legacy root endpoints with auth or
    // a name remain recognizable. Paths and subscription query keys stay remote.
    return (
        url.searchParams.get('proxy') === '1' ||
        Boolean(url.username || url.password) ||
        (explicitPort && Boolean(url.hash || url.search))
    );
}

export function markHttpProxyUrl(value) {
    const endpoint = parseHttpProxyEndpoint(value);
    if (!endpoint || isHttpProxyUrl(value)) return value;
    // Preserve the literal authority, including explicitly written default ports.
    const hash = value.indexOf('#');
    const head = hash === -1 ? value : value.slice(0, hash);
    const tail = hash === -1 ? '' : value.slice(hash);
    return `${head}${head.includes('?') ? '&' : '?'}proxy=1${tail}`;
}

export function isManualNodeSource(item) {
    const value = typeof item === 'string' ? item : item?.url;
    if (typeof value !== 'string' || !value.trim()) return false;
    return NODE_SCHEME.test(value.trim()) || isHttpProxyUrl(value);
}

export function isRemoteSubscriptionSource(item) {
    const value = typeof item === 'string' ? item : item?.url;
    return (
        typeof value === 'string' && /^https?:\/\//i.test(value.trim()) && !isHttpProxyUrl(value)
    );
}
