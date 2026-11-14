import { api, RequestCancelledError } from '../lib/http.js';
import { DEFAULT_USER_AGENT } from '../../shared/user-agents.js';
import { timeLoad } from './load-timing.js';

export const MODAL_DATA_TTL = { LogModal: 15_000, NodePreviewModal: 30_000 };

// Keep only the latest successful result per dialog instance. Source/transform/revision
// changes discard it; a pending request is shared by the shell and loaded component.
export function createModalDataResource({ ttl, accepts = () => true, now = () => Date.now() }) {
    let cached;
    let active;

    const cancel = () => {
        active?.controller.abort(new RequestCancelledError());
        active = undefined;
    };
    const invalidate = () => {
        cancel();
        cached = undefined;
    };
    const read = (descriptor, { refresh = false } = {}) => {
        if (refresh || (cached && (cached.key !== descriptor.key || now() - cached.time >= ttl)))
            invalidate();
        if (cached && cached.key === descriptor.key && now() - cached.time < ttl) {
            return { cached: true, data: cached.data, promise: Promise.resolve(cached.data) };
        }
        if (active?.key === descriptor.key) return active;
        cancel();
        const controller = new AbortController();
        const record = { key: descriptor.key, controller, cached: false };
        active = record;
        record.promise = descriptor.load(controller.signal, refresh).then((data) => {
            // Aborted requests can still resolve in transports that ignore their signal.
            if (active !== record || controller.signal.aborted) throw new RequestCancelledError();
            if (accepts(data)) cached = { key: descriptor.key, data, time: now() };
            return data;
        });
        // Data may finish before the component code arrives. Preserve errors for that
        // component to show, without an unhandled rejection or a duplicate request.
        record.promise.catch(() => {});
        return record;
    };
    return { read, cancel, invalidate };
}

export function modalDataDescriptor(name, props, processed = true, revision = 0) {
    if (name === 'LogModal') {
        return {
            key: JSON.stringify(['logs', props.filterProfileName || '', revision]),
            load: (signal) =>
                timeLoad('misub:data:logs', () => api.get(`/api/logs?t=${Date.now()}`, { signal })),
        };
    }
    const endpoint = props.apiEndpoint || '/api/subscription_nodes';
    const body = { userAgent: DEFAULT_USER_AGENT };
    if (props.profileId)
        Object.assign(body, { profileId: props.profileId, applyTransform: processed });
    else if (props.subscriptionId) body.subscriptionId = props.subscriptionId;
    else if (props.subscriptionUrl) body.url = props.subscriptionUrl;
    else return null;
    return {
        key: JSON.stringify([endpoint, body, revision]),
        body,
        endpoint,
        load: (signal, refresh) =>
            timeLoad('misub:data:node-preview', () =>
                api.post(
                    endpoint,
                    { ...body, ...(refresh ? { forceRefresh: true } : {}) },
                    { signal }
                )
            ),
    };
}
