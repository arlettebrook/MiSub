import { convertClashProxyToUrl } from '../../../src/utils/protocols/clash.js';
import { normalizeProxyHost } from '../../../shared/proxy-address.js';
import { xhttpExtraToClashOptions } from '../../../src/utils/protocols/common/vless-params.js';
const ALIASES = {
    ss: 'ss',
    shadowsocks: 'ss',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hy2: 'hysteria2',
    hysteria2: 'hysteria2',
    tuic: 'tuic',
    anytls: 'anytls',
    mieru: 'mieru',
    http: 'http',
    socks: 'socks5',
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const flag = (value) => [true, 1, '1', 'true', 'yes'].includes(value);
function pick(object, ...keys) {
    for (const key of keys) {
        if (object[key] !== undefined && object[key] !== null) return object[key];
        const matched = Object.keys(object).find(
            (name) => name.toLowerCase() === key.toLowerCase()
        );
        if (matched !== undefined && object[matched] !== null) return object[matched];
    }
}

export function decodeV2rayNLink(link) {
    if (typeof link !== 'string' || link.length > 2 * 1024 * 1024) return null;
    const match = link.trim().match(/^v2rayn:\/\/([a-z0-9+.-]+)\/([^?#]+)(?:[?#].*)?$/i);
    if (!match || !Object.hasOwn(ALIASES, match[1].toLowerCase())) return null;
    try {
        let encoded = decodeURIComponent(match[2]);
        if (!/^[a-z0-9+/_-]*={0,2}$/i.test(encoded)) return null;
        encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        if (encoded.length % 4 === 1) return null;
        encoded += '='.repeat((4 - (encoded.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!isObject(config)) return null;
        const type = ALIASES[match[1].toLowerCase()];
        const configType = pick(config, 'ConfigType');
        const types = {
            vmess: 1,
            ss: 3,
            socks5: 4,
            vless: 5,
            trojan: 6,
            hysteria2: 7,
            tuic: 8,
            http: 10,
            anytls: 11,
        };
        if (typeof configType === 'number' && types[type] !== configType) return null;
        const declared = pick(config, 'Protocol');
        if (declared && ALIASES[String(declared).toLowerCase()] !== type) return null;
        return { type, config };
    } catch {
        return null;
    }
}

export function parseV2rayNLink(link) {
    const decoded = decodeV2rayNLink(link);
    if (!decoded) return null;
    const { type, config } = decoded;
    const get = (...keys) => pick(config, ...keys);
    const address = get('Address', 'Server');
    if (typeof address !== 'string') return null;
    const server = normalizeProxyHost(address);
    const port = Number(get('Port'));
    if (!server || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    // Embedded certificate/ECH/socket configuration cannot be silently replaced
    // with insecure=1. This importer accepts only configurations it can express.
    if (
        get('Cert', 'Certificate') ||
        get('EchConfigList', 'Ech') ||
        get('Sockopt') ||
        get('StreamSettings') ||
        get('Finalmask') ||
        get('Mldsa65Verify') ||
        get('VerifyPeerCertByName') ||
        get('CustomOutboundObj') ||
        get('MuxEnabled') === true
    )
        return null;
    const extraValue = get('ProtoExtraObj', 'ProtoExtra');
    let extra = isObject(extraValue) ? extraValue : {};
    if (typeof extraValue === 'string' && extraValue) {
        try {
            extra = JSON.parse(extraValue);
        } catch {
            return null;
        }
    }
    if (!isObject(extra)) return null;
    const proxy = { type, server, port, name: get('Remarks', 'Name') || `${type}-${server}` };
    const id = type === 'tuic' ? get('Id', 'UUID', 'Username') : get('Id', 'UUID', 'Password');
    const password = get('Password', 'Auth');
    if (['vmess', 'vless', 'tuic'].includes(type)) {
        if (
            typeof id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        )
            return null;
        proxy.uuid = id;
    }
    if (['ss', 'trojan', 'hysteria2', 'tuic', 'anytls', 'mieru'].includes(type)) {
        if (typeof password !== 'string' || !password) return null;
        proxy.password = password;
    }
    const security = String(get('StreamSecurity') || '').toLowerCase();
    if (security && !['none', 'tls', 'reality'].includes(security)) return null;
    proxy.tls = security === 'tls' || security === 'reality';
    const sni = get('Sni', 'ServerName');
    if (typeof sni === 'string' && sni) proxy.servername = sni;
    const insecure = get('AllowInsecure', 'Insecure');
    if (insecure !== undefined) proxy['skip-cert-verify'] = flag(insecure);
    const alpn = get('Alpn');
    if (alpn)
        proxy.alpn = Array.isArray(alpn)
            ? alpn
            : String(alpn)
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean);
    if (get('Fingerprint', 'Fp')) proxy['client-fingerprint'] = get('Fingerprint', 'Fp');
    const pin = get('PinSHA256', 'Hpkp', 'CertSha');
    if (pin && type !== 'hysteria2') return null;
    if (pin) proxy.fingerprint = pin;
    if (security === 'reality') {
        if (type !== 'vless' || !get('PublicKey')) return null;
        proxy['reality-opts'] = { 'public-key': get('PublicKey') };
        if (get('ShortId')) proxy['reality-opts']['short-id'] = get('ShortId');
        if (get('SpiderX')) proxy['reality-opts']['spider-x'] = get('SpiderX');
    }
    let transportExtra = get('TransportExtraObj', 'TransportExtra') || {};
    if (typeof transportExtra === 'string') {
        try {
            transportExtra = JSON.parse(transportExtra);
        } catch {
            return null;
        }
    }
    if (!isObject(transportExtra)) return null;
    for (const value of [
        get('Sni', 'ServerName'),
        get('Fingerprint', 'Fp'),
        pick(transportExtra, 'Host'),
        pick(transportExtra, 'Path'),
        get('Host', 'RequestHost'),
        get('Path'),
    ]) {
        if (value !== undefined && typeof value !== 'string') return null;
    }
    if (
        pick(extra, 'Hy2RealmUrl', 'ChildItems', 'SubChildItems') ||
        pick(extra, 'Uot') === true ||
        pick(transportExtra, 'GrpcAuthority')
    )
        return null;
    const network = String(get('Network') || 'tcp').toLowerCase();
    const path = pick(transportExtra, 'Path') ?? get('Path'),
        host = pick(transportExtra, 'Host') ?? get('Host', 'RequestHost');
    if (['vmess', 'vless', 'trojan'].includes(type)) {
        if (!['tcp', 'ws', 'grpc', 'h2', 'httpupgrade', 'xhttp'].includes(network)) return null;
        if (network === 'xhttp' && type !== 'vless') return null;
        if (network === 'httpupgrade' && type !== 'vless') return null;
        proxy.network = network;
        if (network === 'ws')
            proxy['ws-opts'] = {
                ...(path ? { path } : {}),
                ...(host ? { headers: { Host: host } } : {}),
            };
        if (network === 'grpc')
            proxy['grpc-opts'] = {
                'grpc-service-name':
                    pick(transportExtra, 'GrpcServiceName') ?? path ?? get('ServiceName') ?? '',
                'grpc-mode': pick(transportExtra, 'GrpcMode') ?? get('GrpcMode') ?? 'gun',
            };
        if (network === 'h2')
            proxy['h2-opts'] = { ...(path ? { path } : {}), ...(host ? { host: [host] } : {}) };
        if (network === 'httpupgrade')
            proxy['httpupgrade-opts'] = { path: path || '/', host: host || '' };
        if (network === 'xhttp') {
            let xextra =
                pick(transportExtra, 'XhttpExtra') ??
                get('Extra', 'XhttpExtra') ??
                pick(extra, 'Extra');
            if (typeof xextra === 'string') {
                try {
                    xextra = JSON.parse(xextra);
                } catch {
                    return null;
                }
            }
            proxy['xhttp-opts'] = {
                ...xhttpExtraToClashOptions(xextra),
                path: path || '/',
                host: host || '',
                mode:
                    pick(transportExtra, 'XhttpMode') ??
                    get('XhttpMode', 'Mode') ??
                    pick(extra, 'Mode') ??
                    'auto',
            };
        }
    }
    if (type === 'vmess') {
        proxy.alterId = Number(pick(extra, 'AlterId') ?? get('AlterId') ?? 0);
        proxy.cipher = pick(extra, 'VmessSecurity') ?? get('Security') ?? 'auto';
    }
    if (type === 'vless') {
        proxy.encryption =
            pick(extra, 'VlessEncryption') ?? get('Encryption', 'Security') ?? 'none';
        const flow = pick(extra, 'Flow') ?? get('Flow');
        if (flow) proxy.flow = flow;
        const packet = get('PacketEncoding', 'packet-encoding', 'packet_encoding');
        if (packet !== undefined) proxy['packet-encoding'] = packet;
    }
    if (type === 'ss') {
        proxy.cipher = pick(extra, 'SsMethod') ?? get('Method', 'Security');
        if (!proxy.cipher) return null;
    }
    const headerType = pick(transportExtra, 'RawHeaderType') ?? get('HeaderType');
    if (network === 'tcp' && headerType && headerType !== 'none') {
        if (headerType !== 'http') return null;
        proxy['http-opts'] = {
            ...(path ? { path: [path] } : {}),
            ...(host ? { headers: { Host: [host] } } : {}),
        };
    }
    if (type === 'hysteria2') {
        for (const direction of ['Up', 'Down']) {
            const value = get(`${direction}Mbps`) ?? pick(extra, `${direction}Mbps`);
            if (value !== undefined && value !== '')
                proxy[direction.toLowerCase()] = `${value} Mbps`;
        }
        const obfs = get('Obfs') ?? pick(extra, 'Obfs');
        if (obfs && obfs !== 'none') {
            proxy.obfs = obfs;
            proxy['obfs-password'] = get('ObfsPassword') ?? pick(extra, 'ObfsPassword');
        }
        const salamander = pick(extra, 'SalamanderPass');
        if (salamander) {
            proxy.obfs = 'salamander';
            proxy['obfs-password'] = salamander;
        }
        const ports = pick(extra, 'Ports') ?? get('Ports', 'Mport');
        if (ports) proxy.ports = ports;
        const hop = pick(extra, 'HopInterval') ?? get('HopInterval');
        if (hop) proxy['hop-interval'] = hop;
    }
    if (type === 'tuic') {
        const congestion = get('CongestionControl') ?? pick(extra, 'CongestionControl');
        if (congestion) proxy['congestion-controller'] = congestion;
        const relay = get('UdpRelayMode') ?? pick(extra, 'UdpRelayMode');
        if (relay) proxy['udp-relay-mode'] = relay;
    }
    if (type === 'mieru') {
        proxy.username = get('Username');
        proxy.transport = get('Transport') || 'TCP';
        if (get('Multiplexing')) proxy.multiplexing = get('Multiplexing');
        if (get('HandshakeMode')) proxy['handshake-mode'] = get('HandshakeMode');
    }
    if (type === 'http' || type === 'socks5') {
        proxy.username = get('Username') || '';
        proxy.password = password || '';
        if (type === 'http' && pick(extra, 'HttpHeaders')) {
            let headers = pick(extra, 'HttpHeaders');
            if (typeof headers === 'string') {
                try {
                    headers = JSON.parse(headers);
                } catch {
                    return null;
                }
            }
            if (!isObject(headers)) return null;
            proxy.headers = headers;
        }
    }
    return convertClashProxyToUrl(proxy);
}
