const PACKET_ENCODING_KEYS = ['packet-encoding', 'packet_encoding', 'packetEncoding'];

// Keep an explicitly empty value: sing-box uses it to disable packet encoding.
export function getVlessPacketEncoding(source) {
    for (const key of PACKET_ENCODING_KEYS) {
        const value = typeof source?.get === 'function' ? source.get(key) : source?.[key];
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

const XHTTP_EXTRA_FIELDS = {
    xPaddingBytes: 'x-padding-bytes',
    xPaddingObfsMode: 'x-padding-obfs-mode',
    xPaddingMethod: 'x-padding-method',
    xPaddingPlacement: 'x-padding-placement',
    xPaddingHeader: 'x-padding-header',
    xPaddingKey: 'x-padding-key',
    noGRPCHeader: 'no-grpc-header',
    scMaxEachPostBytes: 'sc-max-each-post-bytes',
    scMinPostsIntervalMs: 'sc-min-posts-interval-ms',
};

export function xhttpExtraToClashOptions(extra) {
    const options = {};
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return options;
    for (const [extraKey, clashKey] of Object.entries(XHTTP_EXTRA_FIELDS)) {
        if (Object.prototype.hasOwnProperty.call(extra, extraKey)) {
            options[clashKey] = extra[extraKey];
        }
    }
    return options;
}

export function clashXhttpOptionsToExtra(options) {
    const extra = {};
    for (const [extraKey, clashKey] of Object.entries(XHTTP_EXTRA_FIELDS)) {
        if (Object.prototype.hasOwnProperty.call(options, clashKey)) {
            extra[extraKey] = options[clashKey];
        }
    }
    return extra;
}
