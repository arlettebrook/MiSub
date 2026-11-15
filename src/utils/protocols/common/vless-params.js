const PACKET_ENCODING_KEYS = ['packet-encoding', 'packet_encoding', 'packetEncoding'];

// Keep an explicitly empty value: sing-box uses it to disable packet encoding.
export function getVlessPacketEncoding(source) {
    for (const key of PACKET_ENCODING_KEYS) {
        const value = typeof source?.get === 'function' ? source.get(key) : source?.[key];
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

export {
    parseXhttpExtra as xhttpExtraToClashOptions,
    serializeXhttpExtra as clashXhttpOptionsToExtra,
    getXhttpHost,
    normalizeXhttpHeaders,
    applyDownloadInheritanceGuard,
} from './xhttp-extra.js';
