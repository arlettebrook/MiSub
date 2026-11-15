// Xray v26.11.9 SplitHTTPConfig <-> Mihomo v1.19.34 XHTTPOptions.
// Download streams are independent in Xray; Mihomo inherits missing fields.
const STRING_FIELDS = {
    xPaddingKey: 'x-padding-key',
    xPaddingHeader: 'x-padding-header',
    xPaddingPlacement: 'x-padding-placement',
    xPaddingMethod: 'x-padding-method',
    uplinkHTTPMethod: 'uplink-http-method',
    sessionIDPlacement: 'session-placement',
    sessionIDKey: 'session-key',
    sessionIDTable: 'session-table',
    seqPlacement: 'seq-placement',
    seqKey: 'seq-key',
    uplinkDataPlacement: 'uplink-data-placement',
    uplinkDataKey: 'uplink-data-key',
};
const RANGE_FIELDS = {
    xPaddingBytes: 'x-padding-bytes',
    sessionIDLength: 'session-length',
    uplinkChunkSize: 'uplink-chunk-size',
    scMaxEachPostBytes: 'sc-max-each-post-bytes',
    scMinPostsIntervalMs: 'sc-min-posts-interval-ms',
};
const BOOL_FIELDS = { noGRPCHeader: 'no-grpc-header', xPaddingObfsMode: 'x-padding-obfs-mode' };
const REUSE_FIELDS = {
    maxConnections: 'max-connections',
    maxConcurrency: 'max-concurrency',
    cMaxReuseTimes: 'c-max-reuse-times',
    hMaxRequestTimes: 'h-max-request-times',
    hMaxReusableSecs: 'h-max-reusable-secs',
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rangeString = (value) =>
    typeof value === 'string' && value !== ''
        ? value
        : typeof value === 'number' && Number.isFinite(value)
          ? String(Math.trunc(value))
          : undefined;

function mapFields(source, reverse = false) {
    const result = {};
    for (const [fields, read] of [
        [STRING_FIELDS, (value) => (typeof value === 'string' && value !== '' ? value : undefined)],
        [RANGE_FIELDS, rangeString],
        [BOOL_FIELDS, (value) => (typeof value === 'boolean' ? value : undefined)],
    ]) {
        for (const [xray, clash] of Object.entries(fields)) {
            const value = read(source[reverse ? clash : xray]);
            if (value !== undefined) result[reverse ? xray : clash] = value;
        }
    }
    return result;
}

// Both clients require map<string, string>. Deduplicate HTTP names without
// mutating the caller; Object.fromEntries also handles a literal __proto__ key.
export function normalizeXhttpHeaders(value, { omitHost = false } = {}) {
    if (!isObject(value)) return {};
    const entries = new Map();
    for (const [key, header] of Object.entries(value)) {
        if (typeof header !== 'string' || (omitHost && key.toLowerCase() === 'host')) continue;
        entries.set(key.toLowerCase(), [key.toLowerCase() === 'host' ? 'Host' : key, header]);
    }
    return Object.fromEntries(entries.values());
}

export function getXhttpHost(options) {
    if (typeof options?.host === 'string' && options.host !== '') return options.host;
    return normalizeXhttpHeaders(options?.headers).Host;
}

function mapReuse(value, reverse = false) {
    if (!isObject(value)) return {};
    const result = {};
    for (const [xray, clash] of Object.entries(REUSE_FIELDS)) {
        const field = rangeString(value[reverse ? clash : xray]);
        if (field !== undefined) result[reverse ? xray : clash] = field;
    }
    const keepalive = value[reverse ? 'h-keep-alive-period' : 'hKeepAlivePeriod'];
    if (typeof keepalive === 'number' && Number.isFinite(keepalive)) {
        result[reverse ? 'hKeepAlivePeriod' : 'h-keep-alive-period'] = Math.trunc(keepalive);
    }
    return result;
}

function stringList(value) {
    const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
    return list
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseDownload(settings) {
    const security =
        typeof settings.security === 'string' ? settings.security.toLowerCase() : 'none';
    const ds = { tls: security === 'tls' || security === 'reality' };
    if (typeof settings.address === 'string' && settings.address !== '')
        ds.server = settings.address;
    if (typeof settings.port === 'number' && Number.isFinite(settings.port))
        ds.port = Math.trunc(settings.port);
    if (ds.tls) {
        const secure = security === 'reality' ? settings.realitySettings : settings.tlsSettings;
        const config = isObject(secure) ? secure : {};
        ds.servername = typeof config.serverName === 'string' ? config.serverName : '';
        ds['client-fingerprint'] =
            typeof config.fingerprint === 'string' && config.fingerprint !== ''
                ? config.fingerprint
                : 'chrome';
        ds.alpn = security === 'tls' ? stringList(config.alpn) : [];
        ds['skip-cert-verify'] = security === 'tls' && config.allowInsecure === true;
        if (security === 'reality') {
            ds['reality-opts'] = {
                'public-key': typeof config.publicKey === 'string' ? config.publicKey : '',
            };
            if (typeof config.shortId === 'string' && config.shortId !== '')
                ds['reality-opts']['short-id'] = config.shortId;
            if (!ds['reality-opts']['public-key'])
                console.warn('[MiSub] XHTTP downloadSettings security=reality 缺少 publicKey');
        }
    }
    const xhttp = isObject(settings.xhttpSettings)
        ? settings.xhttpSettings
        : isObject(settings.splithttpSettings)
          ? settings.splithttpSettings
          : {};
    // Explicit defaults cut Mihomo's inheritance of uplink path, host, headers
    // and connection reuse. Xray builds a separate transport with these defaults.
    ds.path = typeof xhttp.path === 'string' ? xhttp.path : '/';
    ds.host = typeof xhttp.host === 'string' ? xhttp.host : getXhttpHost(xhttp) || '';
    // When extra exists, Xray replaces the transport body with it, except for
    // host/path/mode. In particular headers inside extra win over outer headers.
    const body = isObject(xhttp.extra) ? xhttp.extra : xhttp;
    ds.headers = normalizeXhttpHeaders(body.headers, { omitHost: true });
    ds['reuse-settings'] = mapReuse(xhttp.extra?.xmux || xhttp.xmux);
    return ds;
}

export function parseXhttpExtra(extra) {
    if (!isObject(extra)) return {};
    const options = mapFields(extra);
    for (const [canonical, legacy] of [
        ['sessionIDPlacement', 'sessionPlacement'],
        ['sessionIDKey', 'sessionKey'],
    ]) {
        if (
            !options[STRING_FIELDS[canonical]] &&
            typeof extra[legacy] === 'string' &&
            extra[legacy] !== ''
        ) {
            options[STRING_FIELDS[canonical]] = extra[legacy];
        }
    }
    const headers = normalizeXhttpHeaders(extra.headers);
    if (Object.keys(headers).length) options.headers = headers;
    const reuse = mapReuse(extra.xmux);
    if (Object.keys(reuse).length) options['reuse-settings'] = reuse;
    if (isObject(extra.downloadSettings))
        options['download-settings'] = parseDownload(extra.downloadSettings);
    return options;
}

export function applyDownloadInheritanceGuard(options, { upstreamReality } = {}) {
    const ds = options?.['download-settings'];
    if (!isObject(ds)) return options;
    if (!ds['reality-opts'] && upstreamReality) ds['reality-opts'] = { 'public-key': '' };
    return options;
}

function serializeDownload(ds, proxy, options) {
    const context = isObject(proxy) ? proxy : {};
    const out = { network: 'xhttp' };
    const server = typeof ds.server === 'string' && ds.server !== '' ? ds.server : context.server;
    const port = typeof ds.port === 'number' ? ds.port : Number(context.port);
    if (typeof server === 'string' && server !== '') out.address = server.replace(/^\[|\]$/g, '');
    if (Number.isFinite(port)) out.port = Math.trunc(port);
    const ownReality = isObject(ds['reality-opts']) ? ds['reality-opts'] : null;
    const reality = ownReality || context['reality-opts'];
    const tls = typeof ds.tls === 'boolean' ? ds.tls : context.tls === true;
    const security = tls && reality?.['public-key'] ? 'reality' : tls ? 'tls' : 'none';
    if (security !== 'none') {
        out.security = security;
        const secure = {};
        const servername =
            typeof ds.servername === 'string' ? ds.servername : (context.servername ?? context.sni);
        const fingerprint =
            typeof ds['client-fingerprint'] === 'string'
                ? ds['client-fingerprint']
                : (context['client-fingerprint'] ?? context.fingerprint);
        if (typeof servername === 'string' && servername !== '') secure.serverName = servername;
        if (typeof fingerprint === 'string' && fingerprint !== '' && fingerprint !== 'chrome')
            secure.fingerprint = fingerprint;
        if (security === 'reality') {
            secure.publicKey = reality['public-key'];
            if (typeof reality['short-id'] === 'string' && reality['short-id'] !== '')
                secure.shortId = reality['short-id'];
        } else {
            const alpn = stringList(ds.alpn ?? context.alpn);
            if (alpn.length) secure.alpn = alpn;
            if (
                (ds['skip-cert-verify'] ??
                    context['skip-cert-verify'] ??
                    context.skipCertVerify) === true
            )
                secure.allowInsecure = true;
        }
        if (Object.keys(secure).length)
            out[security === 'reality' ? 'realitySettings' : 'tlsSettings'] = secure;
    }
    const xhttp = {};
    const path = typeof ds.path === 'string' ? ds.path : options.path;
    const host =
        typeof ds.host === 'string' ? ds.host : (getXhttpHost(ds) ?? getXhttpHost(options));
    if (typeof path === 'string' && path !== '') xhttp.path = path;
    if (typeof host === 'string' && host !== '') xhttp.host = host;
    const headers = normalizeXhttpHeaders(ds.headers ?? options.headers, { omitHost: true });
    const xmux = mapReuse(ds['reuse-settings'] ?? options['reuse-settings'], true);
    if (Object.keys(xmux).length) {
        xhttp.extra = { xmux, ...(Object.keys(headers).length ? { headers } : {}) };
    } else if (Object.keys(headers).length) xhttp.headers = headers;
    if (Object.keys(xhttp).length) out.xhttpSettings = xhttp;
    return out;
}

export function serializeXhttpExtra(options, proxy = null) {
    if (!isObject(options)) return {};
    const extra = mapFields(options, true);
    const headers = normalizeXhttpHeaders(options.headers, { omitHost: true });
    if (Object.keys(headers).length) extra.headers = headers;
    const xmux = mapReuse(options['reuse-settings'], true);
    if (Object.keys(xmux).length) extra.xmux = xmux;
    if (isObject(options['download-settings']))
        extra.downloadSettings = serializeDownload(options['download-settings'], proxy, options);
    return extra;
}
