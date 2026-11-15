export function applyHttpSingboxOptions(outbound, proxy) {
    if (proxy.username !== undefined) outbound.username = proxy.username;
    if (proxy.password !== undefined) outbound.password = proxy.password;
    if (proxy.headers && typeof proxy.headers === 'object') {
        outbound.headers = Object.fromEntries(
            Object.entries(proxy.headers)
                .filter(([, value]) => typeof value === 'string')
                .map(([key, value]) => [key, [value]])
        );
    }
    if (String(proxy.type).toLowerCase() === 'https' || proxy.tls === true) {
        outbound.tls = {
            enabled: true,
            server_name: proxy.servername ?? proxy.sni ?? proxy.server,
            insecure: (proxy['skip-cert-verify'] ?? proxy.skipCertVerify) === true,
        };
        if (proxy.alpn)
            outbound.tls.alpn = Array.isArray(proxy.alpn)
                ? [...proxy.alpn]
                : String(proxy.alpn).split(',');
        if (proxy['client-fingerprint'])
            outbound.tls.utls = { enabled: true, fingerprint: proxy['client-fingerprint'] };
    }
    return outbound;
}
