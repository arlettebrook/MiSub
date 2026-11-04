/**
 * Shared HTTP helpers for API requests.
 * Centralizes JSON handling, credentials, and error normalization.
 */

export class APIError extends Error {
    constructor(message, status = 500, data = null) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.data = data;
    }
}

let unauthorizedHandler = null;
let sessionRequestGuard = null;
let connectionErrorHandler = null;

export function configureSessionRequestGuard(handler) {
    sessionRequestGuard = handler;
    return () => {
        if (sessionRequestGuard === handler) sessionRequestGuard = null;
    };
}

export function configureConnectionErrorHandler(handler) {
    connectionErrorHandler = handler;
    return () => {
        if (connectionErrorHandler === handler) connectionErrorHandler = null;
    };
}

const publicApiPaths = new Set([
    '/api/login',
    '/api/logout',
    '/api/public_config',
    '/api/config',
    '/api/public/profiles',
    '/api/public/preview',
    '/api/public/guestbook',
    '/api/system/error_report',
    '/api/github/release',
    '/api/telegram/webhook',
    '/api/external-nodes-callback',
]);

function isPrivateRequest(url, method) {
    try {
        const target = new URL(url, globalThis.window?.location?.href || 'http://localhost/');
        if (globalThis.window && target.origin !== window.location.origin) return false;
        return (
            target.pathname.startsWith('/api/') &&
            !publicApiPaths.has(target.pathname) &&
            !target.pathname.startsWith('/api/ext/v1') &&
            !(target.pathname === '/api/clients' && method === 'GET')
        );
    } catch {
        return false;
    }
}

export function configureUnauthorizedHandler(handler) {
    unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

export class RequestCancelledError extends Error {
    constructor() {
        super('The page is no longer active');
        this.name = 'AbortError';
        this.cancelled = true;
    }
}

const activeRequests = new Map();

export function cancelPendingRequests(backgroundOnly = false) {
    for (const [controller, record] of activeRequests) {
        if (!backgroundOnly || record.background) controller.abort(new RequestCancelledError());
    }
}

export function cancelPrivateRequests(includeSessionChecks = true) {
    for (const [controller, record] of activeRequests) {
        if (record.privateRequest && (includeSessionChecks || !record.sessionCheck)) {
            controller.abort(new RequestCancelledError());
        }
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', (event) => cancelPendingRequests(event.persisted === true));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') cancelPendingRequests(true);
    });
}

const buildHeaders = (headers, body) => {
    if (headers instanceof Headers) {
        return headers;
    }
    const resolved = new Headers(headers || {});
    if (!resolved.has('Content-Type') && body !== undefined) {
        resolved.set('Content-Type', 'application/json');
    }
    return resolved;
};

const parseJson = async (response) => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
};

export async function request(url, options = {}) {
    const {
        headers,
        body,
        signal,
        background = false,
        timeoutMs,
        sessionCheck = false,
        ...rest
    } = options;
    const privateRequest = isPrivateRequest(url, String(rest.method || 'GET').toUpperCase());
    if (privateRequest && !sessionCheck && sessionRequestGuard && !sessionRequestGuard()) {
        throw new RequestCancelledError();
    }
    if (background && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        throw new RequestCancelledError();
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    activeRequests.set(controller, { background, privateRequest, sessionCheck });
    const timeout =
        timeoutMs > 0
            ? setTimeout(
                  () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
                  timeoutMs
              )
            : null;

    try {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            ...rest,
            body,
            headers: buildHeaders(headers, body),
            signal: controller.signal,
        });
        const data = await parseJson(response);
        controller.signal.throwIfAborted();
        if (!response.ok) {
            if (response.status === 401) {
                try {
                    unauthorizedHandler?.({ url, data });
                } catch (error) {
                    console.warn('[HTTP] Unauthorized handler failed:', error);
                }
            }
            const message = data?.message || data?.error || `HTTP ${response.status}`;
            throw new APIError(message, response.status, data);
        }
        return data;
    } catch (error) {
        if (controller.signal.reason?.cancelled) throw controller.signal.reason;
        const networkFailure =
            error instanceof TypeError ||
            error?.name === 'TimeoutError' ||
            controller.signal.reason?.name === 'TimeoutError' ||
            error?.status >= 500;
        if (privateRequest && !sessionCheck && networkFailure)
            connectionErrorHandler?.({ url, error });
        if (controller.signal.reason?.cancelled) throw controller.signal.reason;
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', forwardAbort);
        activeRequests.delete(controller);
    }
}

const stringifyBody = (data) => (data === undefined ? undefined : JSON.stringify(data));

export const api = {
    get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
    post: (url, data, options = {}) =>
        request(url, { ...options, method: 'POST', body: stringifyBody(data) }),
    put: (url, data, options = {}) =>
        request(url, { ...options, method: 'PUT', body: stringifyBody(data) }),
    patch: (url, data, options = {}) =>
        request(url, { ...options, method: 'PATCH', body: stringifyBody(data) }),
    del: (url, options = {}) => request(url, { ...options, method: 'DELETE' }),
};
