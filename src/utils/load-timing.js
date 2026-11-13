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
    return () => {
        pending ||= timeLoad(name, load).catch((error) => {
            pending = undefined;
            throw error;
        });
        return pending;
    };
}
