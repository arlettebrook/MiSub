// Local display preferences only; subscription data and backups are unaffected.
const STORAGE_KEY = 'misub:dismissedHealthItems';
const MAX_ENTRIES = 100;

function readAll() {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((id) => typeof id === 'string' && id);
    } catch {
        return [];
    }
}

function writeAll(ids) {
    try {
        if (typeof localStorage === 'undefined') return;
        // Keep the newest entries when the local history reaches its limit.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-MAX_ENTRIES)));
    } catch {
        // Storage may be unavailable or full; keep the dashboard usable.
    }
}

export function isHealthItemDismissed(id) {
    const key = String(id || '').trim();
    return Boolean(key) && readAll().includes(key);
}

export function readDismissedHealthItemIds() {
    return readAll();
}

export function dismissHealthItem(id) {
    const key = String(id || '').trim();
    if (!key) return;
    const ids = readAll();
    if (ids.includes(key)) return;
    ids.push(key);
    writeAll(ids);
}

export function restoreHealthItem(id) {
    const key = String(id || '').trim();
    if (!key) return;
    writeAll(readAll().filter((entry) => entry !== key));
}

export function clearDismissedHealthItems() {
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage may be unavailable.
    }
}

export function filterDismissedHealthItems(items) {
    if (!Array.isArray(items)) return [];
    const dismissed = new Set(readAll());
    return items.filter((item) => !dismissed.has(item.id));
}

export const DISMISSED_HEALTH_ITEMS_KEY = STORAGE_KEY;
