export const SESSION_EVENT_KEY = 'misub:session-event';
export const SESSION_CHANNEL = 'misub:session';
export const LOGOUT_PENDING_MS = 30000;

function validEvent(value) {
    return (
        value &&
        ['logout-start', 'logout', 'logout-cancelled'].includes(value.type) &&
        typeof value.id === 'string' &&
        value.id.length <= 128 &&
        typeof value.sender === 'string' &&
        Number.isFinite(value.time)
    );
}

export function readSessionEvent() {
    try {
        const value = JSON.parse(localStorage.getItem(SESSION_EVENT_KEY) || 'null');
        return validEvent(value) ? value : null;
    } catch {
        return null;
    }
}

export function createSessionSync(onEvent) {
    const sender = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    let seen = readSessionEvent()?.id;
    let channel;
    let closed = false;
    const receive = (event) => {
        if (closed || !validEvent(event) || event.sender === sender || event.id === seen) return;
        seen = event.id;
        onEvent(event);
    };
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel(SESSION_CHANNEL);
            channel.onmessage = ({ data }) => receive(data);
        }
    } catch {
        // Storage events and foreground session verification remain available.
    }
    const onStorage = (event) => {
        if (event.key !== SESSION_EVENT_KEY) return;
        try {
            receive(JSON.parse(event.newValue));
        } catch {
            /* Ignore unrelated or malformed data. */
        }
    };
    window.addEventListener('storage', onStorage);
    return {
        publish(type) {
            if (closed) return;
            const event = {
                type,
                sender,
                id: `${sender}:${Date.now()}:${Math.random()}`,
                time: Date.now(),
            };
            seen = event.id;
            try {
                localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify(event));
            } catch {
                /* Broadcast still works. */
            }
            try {
                channel?.postMessage(event);
            } catch {
                /* Storage fallback still works. */
            }
        },
        consume() {
            receive(readSessionEvent());
        },
        close() {
            closed = true;
            window.removeEventListener('storage', onStorage);
            channel?.close();
        },
    };
}
