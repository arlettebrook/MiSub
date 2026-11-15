import { readStorage, writeStorage } from './browser-storage.js';

export const CHUNK_RELOAD_KEY = 'misub:chunk-reload';
export const ASSET_RELOAD_KEY = 'misub:asset-reload';

export function isChunkLoadError(error) {
    const message = error?.message || '';
    return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('error loading dynamically imported module')
    );
}

export function claimReload(key) {
    const unavailable = Symbol('unavailable');
    const previous = readStorage(key, unavailable, 'sessionStorage');
    if (previous === unavailable) return 'unavailable';
    if (previous === '1') return 'already-reloaded';

    // Never reload on a silent/dropped write: an in-memory flag cannot stop a
    // reload loop across documents. Claim before any asynchronous cache cleanup.
    if (!writeStorage(key, '1', 'sessionStorage')) return 'unavailable';
    return readStorage(key, unavailable, 'sessionStorage') === '1' ? 'ready' : 'unavailable';
}
