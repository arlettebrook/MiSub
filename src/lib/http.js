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
    for (const [controller, background] of activeRequests) {
        if (!backgroundOnly || background) controller.abort(new RequestCancelledError());
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
    const { headers, body, signal, background = false, timeoutMs, ...rest } = options;
    if (background && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        throw new RequestCancelledError();
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    activeRequests.set(controller, background);
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
