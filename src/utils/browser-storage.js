// Resolve the storage object inside try: its getter can itself throw SecurityError.
// Preferences are optional; callers that require persistence must verify a write.
// A missing key is null; fallback distinguishes unavailable storage when needed.
export function readStorage(key, fallback = null, storageName = 'localStorage') {
    try {
        const storage = globalThis[storageName];
        return storage ? storage.getItem(key) : fallback;
    } catch {
        return fallback;
    }
}

export function writeStorage(key, value, storageName = 'localStorage') {
    try {
        const storage = globalThis[storageName];
        if (!storage) return false;
        storage.setItem(key, String(value));
        return true;
    } catch {
        return false;
    }
}
