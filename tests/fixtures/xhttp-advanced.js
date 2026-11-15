export const XHTTP_UUID = '11111111-1111-4111-8111-111111111111';
export const XHTTP_PUBLIC_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const XHTTP_EXTRA = {
    xPaddingBytes: '100-1000',
    xPaddingObfsMode: false,
    xPaddingMethod: 'tokenish',
    xPaddingPlacement: 'queryInHeader',
    xPaddingHeader: 'X-Padding',
    xPaddingKey: 'padding+%&=',
    noGRPCHeader: false,
    uplinkHTTPMethod: 'POST',
    sessionIDPlacement: 'header',
    sessionIDKey: 'X-Session',
    sessionIDTable: 'hex',
    sessionIDLength: 16,
    seqPlacement: 'query',
    seqKey: 'seq',
    uplinkDataPlacement: 'header',
    uplinkDataKey: 'X-Data',
    uplinkChunkSize: 1024,
    scMaxEachPostBytes: '1048576',
    scMinPostsIntervalMs: 0,
    headers: { 'X-Trace': 'value+%&=中文', 'User-Agent': 'Synthetic/1.0' },
    xmux: {
        maxConnections: 3,
        maxConcurrency: 0,
        cMaxReuseTimes: '0-5',
        hMaxRequestTimes: '600-900',
        hMaxReusableSecs: 1800,
        hKeepAlivePeriod: 0,
    },
};
export function xhttpLink(extra = XHTTP_EXTRA, security = 'tls') {
    const params = new URLSearchParams({
        type: 'xhttp',
        path: '/upload',
        host: 'upload.example',
        mode: 'packet-up',
        encryption: 'none',
        packetEncoding: 'packetaddr',
        security,
        sni: 'upload-tls.example',
        alpn: 'h2',
        fp: 'firefox',
        extra: JSON.stringify(extra),
    });
    if (security === 'reality') {
        params.set('pbk', XHTTP_PUBLIC_KEY);
        params.set('sid', 'abcd');
    }
    return `vless://${XHTTP_UUID}@[2001:db8::1]:443?${params.toString()}#XHTTP`;
}
