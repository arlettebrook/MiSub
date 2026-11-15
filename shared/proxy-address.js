// Keep host values separate from the brackets required in URI authorities.
export function normalizeProxyHost(value) {
    const host = String(value ?? '').trim();
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function formatUriHost(value) {
    const host = normalizeProxyHost(value);
    return host.includes(':') ? `[${host}]` : host;
}

export function splitUriHostPort(value) {
    const authority = String(value ?? '').trim();
    if (authority.startsWith('[')) {
        const close = authority.indexOf(']');
        if (close !== -1) {
            const rest = authority.slice(close + 1);
            return {
                server: authority.slice(1, close),
                port: rest.startsWith(':') ? rest.slice(1) : '',
            };
        }
    }

    const lastColon = authority.lastIndexOf(':');
    if (lastColon === -1) return { server: authority, port: '' };
    const host = authority.slice(0, lastColon);
    const port = authority.slice(lastColon + 1);
    if (!host.includes(':')) return { server: host, port };

    // Recover older emitted links only if the suffix is a port and the remaining
    // host is a valid IPv6 literal. Constructing a URL does not make a request.
    if (
        /^[0-9a-f:.]+$/i.test(host) &&
        /^\d+$/.test(port) &&
        Number(port) > 0 &&
        Number(port) <= 65535
    ) {
        try {
            new URL(`http://[${host}]/`);
            return { server: host, port };
        } catch {
            // Keep an IPv6 literal without a distinguishable port intact.
        }
    }
    return { server: authority, port: '' };
}
