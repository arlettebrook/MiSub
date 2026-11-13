import { navigationLoaders } from './navigation-loaders.js';

export function createNavigationPreloader({ loaders = navigationLoaders, host = window } = {}) {
    const loadedPaths = new Set();
    let generation = 0;
    let cancelPending;
    let inFlight;

    const stop = () => {
        generation++;
        cancelPending?.();
        cancelPending = undefined;
    };

    const start = (currentPath) => {
        stop();
        loadedPaths.add(currentPath);
        const queue = Object.entries(loaders).filter(([path]) => !loadedPaths.has(path));
        const run = generation;

        const scheduleNext = () => {
            while (queue.length && loadedPaths.has(queue[0][0])) queue.shift();
            if (run !== generation || !queue.length) return;
            if (inFlight) {
                void inFlight.then(scheduleNext);
                return;
            }

            const loadNext = async () => {
                cancelPending = undefined;
                if (run !== generation) return;
                const [path, loader] = queue.shift();
                inFlight = (async () => {
                    try {
                        await loader();
                        loadedPaths.add(path);
                    } catch {
                        // A failed background load must not interrupt the current page.
                        // Navigation can retry the original lazy import when needed.
                    }
                })();
                await inFlight;
                inFlight = undefined;
                scheduleNext();
            };

            if (typeof host.requestIdleCallback === 'function') {
                const id = host.requestIdleCallback(loadNext, { timeout: 2000 });
                cancelPending = () => host.cancelIdleCallback(id);
            } else {
                const id = host.setTimeout(loadNext, 500);
                cancelPending = () => host.clearTimeout(id);
            }
        };

        scheduleNext();
    };

    return { start, stop };
}
