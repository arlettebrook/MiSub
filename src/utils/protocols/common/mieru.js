import { formatUriHost, normalizeProxyHost } from '../../../../shared/proxy-address.js';

const MULTIPLEXING = new Set([
    'MULTIPLEXING_DEFAULT',
    'MULTIPLEXING_OFF',
    'MULTIPLEXING_LOW',
    'MULTIPLEXING_MIDDLE',
    'MULTIPLEXING_HIGH',
]);
const HANDSHAKE = new Set(['HANDSHAKE_DEFAULT', 'HANDSHAKE_STANDARD', 'HANDSHAKE_NO_WAIT']);
const textDecoder = new TextDecoder('utf-8', { fatal: true });
function base64Bytes(value) {
    if (
        !/^[a-z0-9+/_-]*={0,2}$/i.test(value) ||
        value.length > 2 * 1024 * 1024 ||
        value.length % 4 === 1
    )
        throw new Error('Invalid payload');
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(
        atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4)),
        (char) => char.charCodeAt(0)
    );
}
function encodeBytes(bytes) {
    let value = '';
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value);
}
// Read only the official ClientConfig fields needed for outbound nodes. Local
// listeners/logging are intentionally not installed as application settings.
function protobuf(bytes) {
    let offset = 0;
    const fields = new Map();
    const varint = () => {
        let value = 0,
            multiplier = 1;
        for (let count = 0; count < 8; count++) {
            if (offset >= bytes.length) throw new Error('Truncated protobuf');
            const byte = bytes[offset++];
            value += (byte & 127) * multiplier;
            if (!Number.isSafeInteger(value)) throw new Error('Integer overflow');
            if (byte < 128) return value;
            multiplier *= 128;
        }
        throw new Error('Invalid varint');
    };
    while (offset < bytes.length) {
        const key = varint(),
            number = Math.floor(key / 8),
            wire = key % 8;
        if (!number) throw new Error('Invalid field');
        let value;
        if (wire === 0) value = varint();
        else if (wire === 2) {
            const length = varint();
            if (offset + length > bytes.length) throw new Error('Truncated field');
            value = bytes.slice(offset, offset + length);
            offset += length;
        } else if (wire === 1 || wire === 5) {
            offset += wire === 1 ? 8 : 4;
            if (offset > bytes.length) throw new Error('Truncated field');
            continue;
        } else throw new Error('Unsupported wire type');
        fields.set(number, [...(fields.get(number) || []), value]);
    }
    return fields;
}
const first = (fields, key) => fields.get(key)?.at(-1);
const stringField = (fields, key) =>
    first(fields, key) instanceof Uint8Array ? textDecoder.decode(first(fields, key)) : undefined;
function parseFullMieru(link) {
    try {
        const config = protobuf(base64Bytes(link.trim().slice(8).split('#')[0]));
        const results = [];
        for (const profileBytes of config.get(1) || []) {
            const profile = protobuf(profileBytes),
                user = protobuf(first(profile, 2));
            if (first(profile, 8)) return []; // Independent SOCKS dialer has no equivalent here.
            const base = {
                name: stringField(profile, 1),
                profile: stringField(profile, 1),
                username: stringField(user, 1),
                password: stringField(user, 2),
            };
            if (first(profile, 4) !== undefined) base.mtu = first(profile, 4);
            if (first(profile, 5)) {
                base.multiplexing = [...MULTIPLEXING][first(protobuf(first(profile, 5)), 1) || 0];
                if (!base.multiplexing) return [];
            }
            if (first(profile, 6) !== undefined) {
                base['handshake-mode'] = [...HANDSHAKE][first(profile, 6)];
                if (!base['handshake-mode']) return [];
            }
            if (first(profile, 7)) base['traffic-pattern'] = encodeBytes(first(profile, 7));
            for (const serverBytes of profile.get(3) || []) {
                const server = protobuf(serverBytes);
                for (const bindingBytes of server.get(3) || []) {
                    const binding = protobuf(bindingBytes);
                    const proxy = normalizeMieruProxy({
                        ...base,
                        server: stringField(server, 2) || stringField(server, 1),
                        ...(stringField(binding, 3)
                            ? { 'port-range': stringField(binding, 3) }
                            : { port: first(binding, 1) }),
                        transport: { 1: 'UDP', 2: 'TCP' }[first(binding, 2)] || 'UNKNOWN',
                    });
                    if (!proxy || results.length >= 64) return [];
                    results.push(proxy);
                }
            }
        }
        return results.map((proxy, index) => ({
            ...proxy,
            name: results.length > 1 ? `${proxy.name} (${index + 1})` : proxy.name,
        }));
    } catch {
        return [];
    }
}
function portRange(value) {
    const match = String(value ?? '').match(/^(\d+)-(\d+)$/);
    if (
        !match ||
        Number(match[1]) < 1 ||
        Number(match[2]) > 65535 ||
        Number(match[1]) > Number(match[2])
    )
        return null;
    return `${Number(match[1])}-${Number(match[2])}`;
}

export function normalizeMieruProxy(input) {
    if (!input || typeof input !== 'object') return null;
    if (typeof input.server !== 'string') return null;
    const server = normalizeProxyHost(input.server);
    const port = input.port == null ? undefined : Number(input.port);
    const range = input['port-range'] == null ? undefined : portRange(input['port-range']);
    if (
        !server ||
        (port === undefined && !range) ||
        (port !== undefined && range !== undefined) ||
        (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    )
        return null;
    if (
        typeof input.username !== 'string' ||
        !input.username ||
        typeof input.password !== 'string' ||
        !input.password
    )
        return null;
    const transport = String(input.transport || 'TCP').toUpperCase();
    if (!['TCP', 'UDP'].includes(transport)) return null;
    if (input.multiplexing !== undefined && !MULTIPLEXING.has(input.multiplexing)) return null;
    if (input['handshake-mode'] !== undefined && !HANDSHAKE.has(input['handshake-mode']))
        return null;
    const proxy = {
        name: input.name || input.profile || 'Mieru',
        type: 'mieru',
        server,
        ...(range ? { 'port-range': range } : { port }),
        username: input.username,
        password: input.password,
        transport,
    };
    for (const key of [
        'multiplexing',
        'handshake-mode',
        'traffic-pattern',
        'profile',
        'dialer-proxy',
    ]) {
        if (input[key] !== undefined) {
            if (typeof input[key] !== 'string') return null;
            proxy[key] = input[key];
        }
    }
    if (input.udp !== undefined) {
        if (typeof input.udp !== 'boolean') return null;
        proxy.udp = input.udp;
    }
    if (input.mtu !== undefined) {
        const mtu = Number(input.mtu);
        if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1500) return null;
        proxy.mtu = mtu;
    }
    return proxy;
}

export function convertMieruToUrl(input) {
    const proxy = normalizeMieruProxy(input);
    if (!proxy) return null;
    const params = new URLSearchParams({
        profile: proxy.profile || proxy.name,
        port: proxy['port-range'] || String(proxy.port),
        protocol: proxy.transport,
    });
    for (const key of ['multiplexing', 'handshake-mode', 'traffic-pattern', 'mtu', 'udp']) {
        if (proxy[key] !== undefined) params.set(key, String(proxy[key]));
    }
    if (proxy['dialer-proxy']) params.set('dp', proxy['dialer-proxy']);
    return `mierus://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${formatUriHost(proxy.server)}?${params}#${encodeURIComponent(proxy.name)}`;
}

// Official simple links pair repeatable port/protocol parameters. Each pair
// becomes one Mihomo node; a single native proxy cannot hold mixed bindings.
export function parseMieruLinks(link) {
    if (typeof link === 'string' && /^mieru:\/\//i.test(link.trim())) return parseFullMieru(link);
    if (typeof link !== 'string' || !/^mierus:\/\//i.test(link.trim())) return [];
    try {
        const url = new URL(link.trim()),
            params = url.searchParams;
        if (!url.hostname || (url.pathname && url.pathname !== '/')) return [];
        const username = url.username ? decodeURIComponent(url.username) : params.get('username');
        const password =
            url.username || url.password
                ? decodeURIComponent(url.password)
                : params.get('password');
        const names = params.getAll('profile');
        if (names.length > 1 || (!names.length && !url.port)) return [];
        for (const key of [
            'multiplexing',
            'handshake-mode',
            'traffic-pattern',
            'mtu',
            'udp',
            'dp',
        ]) {
            if (params.getAll(key).length > 1) return [];
        }
        let name = url.hash ? decodeURIComponent(url.hash.slice(1)) : names[0] || 'Mieru';
        const base = {
            name,
            type: 'mieru',
            server: normalizeProxyHost(url.hostname),
            username,
            password,
        };
        for (const key of ['multiplexing', 'handshake-mode', 'traffic-pattern', 'profile']) {
            if (params.has(key)) base[key] = params.get(key);
        }
        if (params.has('mtu')) base.mtu = params.get('mtu');
        if (params.has('dp')) base['dialer-proxy'] = params.get('dp');
        if (params.has('udp')) {
            if (!['true', 'false', '1', '0'].includes(params.get('udp'))) return [];
            base.udp = ['true', '1'].includes(params.get('udp'));
        }
        let ports = params.getAll('port'),
            protocols = params.getAll('protocol');
        // Compatibility with the upstream MiSub internal authority form.
        if (!ports.length && url.port) {
            ports = [url.port];
            protocols = [params.get('transport') || 'TCP'];
        }
        if (!ports.length || ports.length > 64 || protocols.length !== ports.length) return [];
        const proxies = ports.map((port, index) =>
            normalizeMieruProxy({
                ...base,
                name: ports.length > 1 ? `${name} (${index + 1})` : name,
                ...(port.includes('-') ? { 'port-range': port } : { port }),
                transport: protocols[index],
            })
        );
        return proxies.every(Boolean) ? proxies : [];
    } catch {
        return [];
    }
}

export function assertMieruTargetSupported(proxies, target, isMeta = false) {
    if (!proxies?.some((proxy) => proxy?.type === 'mieru')) return;
    if (target === 'clash' && isMeta) {
        // Mihomo's MieruOption does not expose MTU; its native client uses 1400.
        // Retain this import metadata, but reject an effective non-default MTU.
        if (
            !proxies.some(
                (proxy) =>
                    proxy.type === 'mieru' && proxy.mtu !== undefined && Number(proxy.mtu) !== 1400
            )
        )
            return;
        const error = new Error(
            'Mihomo Mieru cannot preserve a non-default MTU; use the native Mieru client configuration'
        );
        error.code = 'MIERU_UNSUPPORTED_TARGET';
        throw error;
    }
    const error = new Error(
        `Mieru requires Mihomo/Meta output (meta=true); ${target} cannot preserve this protocol`
    );
    error.code = 'MIERU_UNSUPPORTED_TARGET';
    throw error;
}
