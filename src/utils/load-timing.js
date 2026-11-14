// Keep the latest code/request timings available in browser Performance tools.
export async function timeLoad(name, load) {
    const clock = globalThis.performance;
    const start = clock?.now();
    try {
        return await load();
    } finally {
        if (start !== undefined && clock?.measure) {
            try {
                clock.clearMeasures?.(name);
                clock.measure(name, { start, end: clock.now() });
            } catch {
                // Diagnostics must not change a successful load or its original error.
            }
        }
    }
}

export function cachedLoader(name, load) {
    let pending;
    let resolved;
    const loader = () => {
        pending ||= timeLoad(name, load)
            .then((module) => {
                resolved = module;
                return module;
            })
            .catch((error) => {
                pending = undefined;
                throw error;
            });
        return pending;
    };
    // A preloaded module can render synchronously without a loading placeholder.
    loader.peek = () => resolved;
    return loader;
}
