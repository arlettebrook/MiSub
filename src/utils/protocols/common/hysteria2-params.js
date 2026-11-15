// HY2's fingerprint pins the entire certificate. client-fingerprint describes
// the TLS ClientHello and must never be substituted for this certificate hash.
export function getHysteria2CertificatePin(source) {
    for (const key of ['pinSHA256', 'hpkp', 'fingerprint', 'server-cert-fingerprint-sha256']) {
        const value = typeof source?.get === 'function' ? source.get(key) : source?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

export function normalizeHysteria2Ports(value, separator = '-') {
    const text = Array.isArray(value) ? value.join(',') : String(value ?? '');
    if (!text.trim()) return undefined;
    const parts = text.split(',').map((part) => part.trim());
    const normalized = [];
    for (const part of parts) {
        const match = part.match(/^(\d+)(?:[:-](\d+))?$/);
        if (!match) return undefined;
        const start = Number(match[1]),
            end = match[2] ? Number(match[2]) : start;
        if (start < 1 || end > 65535 || end < start) return undefined;
        normalized.push(match[2] && end !== start ? `${start}${separator}${end}` : String(start));
    }
    return normalized.join(',');
}

function durationSeconds(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
    const text = String(value ?? '').trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const parts = text.match(/\d+(?:\.\d+)?(?:ms|s|m|h)/g);
    if (!parts || parts.join('') !== text) return undefined;
    return parts.reduce((total, part) => {
        const [, number, unit] = part.match(/^(.*?)(ms|s|m|h)$/);
        return total + Number(number) * { ms: 0.001, s: 1, m: 60, h: 3600 }[unit];
    }, 0);
}

export function normalizeHysteria2HopInterval(value) {
    if (value === undefined || value === null || value === '' || typeof value === 'boolean')
        return undefined;
    const text = String(value).trim();
    const range = text.split('-');
    if (range.length > 2) return undefined;
    const start = durationSeconds(range[0]);
    const end = range.length === 2 ? durationSeconds(range[1]) : undefined;
    // Mihomo accepts unsigned integer seconds or an integer range.
    if (
        start === undefined ||
        !Number.isInteger(start) ||
        (range.length === 2 && (end === undefined || !Number.isInteger(end) || end < start))
    )
        return undefined;
    return range.length === 2 ? `${start}-${end}` : String(start);
}

export function getHysteria2HopInterval(source) {
    for (const key of ['hop-interval', 'hopInterval', 'hop_interval', 'port-hopping-interval']) {
        const value = typeof source?.get === 'function' ? source.get(key) : source?.[key];
        const normalized = normalizeHysteria2HopInterval(value);
        if (normalized !== undefined) return normalized;
    }
    return undefined;
}

export function assertHysteria2CertificatePinSupport(proxy, target) {
    if (!getHysteria2CertificatePin(proxy)) return;
    const message =
        target === 'sing-box'
            ? 'HY2 certificate pinSHA256 cannot be converted to sing-box certificate_public_key_sha256: certificate hashes and public-key hashes are different'
            : `HY2 certificate pinSHA256 has no verified equivalent in the ${target} exporter; use Clash/Mihomo or Surge to retain certificate pinning`;
    const error = new Error(message);
    error.code = 'HY2_UNSUPPORTED_CERT_PIN';
    throw error;
}

export function getHysteria2ScalarHopInterval(proxy, target) {
    const interval = getHysteria2HopInterval(proxy);
    if (interval?.includes('-')) {
        const error = new Error(
            `${target} HY2 export supports a single hop interval; the range ${interval} cannot be represented`
        );
        error.code = 'HY2_UNSUPPORTED_HOP_RANGE';
        throw error;
    }
    return interval;
}

export function hysteria2BandwidthMbps(value) {
    const match = String(value ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:Mbps)?\s*$/i);
    return match ? Math.trunc(Number(match[1])) : undefined;
}

// Verified Surge/Loon field names plus commonly imported aliases.
export function hysteria2IniOptionToQuery(key, value) {
    const names = {
        peer: 'sni',
        pinsha256: 'pinSHA256',
        hpkp: 'pinSHA256',
        fingerprint: 'pinSHA256',
        'server-cert-fingerprint-sha256': 'pinSHA256',
        ports: 'ports',
        mport: 'ports',
        'server-ports': 'ports',
        'port-hopping': 'ports',
        'hop-interval': 'hop-interval',
        'port-hopping-interval': 'hop-interval',
        upmbps: 'up',
        downmbps: 'down',
        'download-bandwidth': 'down',
        alpn: 'alpn',
    };
    const lowerKey = String(key).toLowerCase();
    if (!Object.hasOwn(names, lowerKey)) return null;
    const canonical = names[lowerKey];
    if (canonical === 'ports') value = normalizeHysteria2Ports(String(value).replace(/;/g, ','));
    if (canonical === 'hop-interval') value = normalizeHysteria2HopInterval(value);
    return value === undefined ? null : [canonical, value];
}

export function applyHysteria2SingboxOptions(outbound, proxy) {
    assertHysteria2CertificatePinSupport(proxy, 'sing-box');
    const ports = normalizeHysteria2Ports(proxy.ports, ':');
    if (ports)
        outbound.server_ports = ports
            .split(',')
            .map((part) => (part.includes(':') ? part : `${part}:${part}`));
    const interval = getHysteria2HopInterval(proxy);
    if (interval !== undefined) {
        const [rawStart, rawEnd] = interval.split('-').map(Number);
        // Match Mihomo: zero uses the default 30s; intervals below 5s clamp to 5s.
        const start = rawStart === 0 ? 30 : Math.max(rawStart, 5);
        outbound.hop_interval = `${start}s`;
        if (rawEnd !== undefined) outbound.hop_interval_max = `${Math.max(rawEnd, start)}s`;
    }
    if (proxy.alpn)
        outbound.tls.alpn = Array.isArray(proxy.alpn)
            ? [...proxy.alpn]
            : String(proxy.alpn).split(',');
    for (const direction of ['up', 'down']) {
        const value = proxy[direction] ?? proxy[`${direction}-mbps`];
        const mbps = hysteria2BandwidthMbps(value);
        if (mbps !== undefined) outbound[`${direction}_mbps`] = mbps;
    }
    return outbound;
}
