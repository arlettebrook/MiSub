/**
 * 过滤全局事件中可确认的扩展、注入脚本及跨域第三方错误。
 * 同源代码和来源不明的错误继续上报，避免隐藏应用自身故障。
 */
const EXTENSION_PROTOCOL = /^(?:chrome|moz|safari-web|safari)-extension:\/\//i;
const INJECTED_SCRIPT = /^(?:VM\d+(?::[\d:]+)?$|about:|data:|eval(?:$|:|\s))/i;
const EXTENSION_IN_STACK = /(?:chrome|moz|safari-web|safari)-extension:\/\//i;
const INJECTED_IN_STACK = /(?:^|[\s(@])(?:VM\d+(?::[\d:]+)?|about:blank|data:|eval(?:$|:|\s))/m;
const URL_IN_STACK = /(?:blob:)?https?:\/\/[^\s)]+/g;
const OPAQUE_ERROR_MESSAGE = 'Script error.';

function resolveOrigin(origin) {
    return origin || (typeof window !== 'undefined' ? window.location?.origin : null);
}

function safeOrigin(url, base) {
    try {
        const origin = new URL(url, base || undefined).origin;
        return origin === 'null' ? null : origin;
    } catch {
        return null;
    }
}

/** 是否应当将 window error 事件作为应用错误处理。 */
export function isAppScriptError(info = {}, origin) {
    const filename = String(info.filename || '').trim();
    if (!filename) {
        return String(info.message || '').trim() !== OPAQUE_ERROR_MESSAGE;
    }
    if (EXTENSION_PROTOCOL.test(filename) || INJECTED_SCRIPT.test(filename)) return false;

    const base = resolveOrigin(origin);
    const scriptOrigin = safeOrigin(filename, base);
    // 无法确认来源时保留；同源 blob URL 也可能由应用生成。
    if (!base || !scriptOrigin) return true;
    return scriptOrigin === base;
}

/** 是否可以确认 Promise 拒绝属于第三方噪音。 */
export function isForeignRejection(reason, origin) {
    if (!reason) return false;

    const stack = String(reason.stack || '');
    // 只检查栈帧，错误消息中的 URL 或扩展名称不代表实际脚本来源。
    const frames = stack
        .split('\n')
        .filter((line) => /^\s*at\s/.test(line) || /^[^\s]*@/.test(line))
        .join('\n');
    const base = resolveOrigin(origin);
    const urls = frames.match(URL_IN_STACK) || [];
    const origins = urls.map((url) => safeOrigin(url, base));

    // 扩展可能调用本站代码；栈中包含本站帧时继续报告真实故障。
    if (base && origins.includes(base)) return false;
    if (EXTENSION_IN_STACK.test(frames) || INJECTED_IN_STACK.test(frames)) return true;
    if (String(reason.message || reason).trim() === OPAQUE_ERROR_MESSAGE) return true;

    return Boolean(base && origins.length && origins.every((item) => item && item !== base));
}
