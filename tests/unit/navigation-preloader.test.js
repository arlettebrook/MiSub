import { describe, expect, it, vi } from 'vitest';
import { createNavigationPreloader } from '../../src/router/navigation-preloader.js';

function idleHost() {
    const callbacks = new Map();
    let nextId = 0;
    return {
        callbacks,
        requestIdleCallback: vi.fn((callback) => {
            callbacks.set(++nextId, callback);
            return nextId;
        }),
        cancelIdleCallback: vi.fn((id) => callbacks.delete(id)),
        async runNext() {
            const [id, callback] = callbacks.entries().next().value;
            callbacks.delete(id);
            await callback();
        },
    };
}

describe('navigation background preloading', () => {
    it('waits for idle time and loads one page at a time, skipping the current page', async () => {
        const host = idleHost();
        const dashboard = vi.fn();
        let finishGroups;
        const groups = vi.fn(() => new Promise((resolve) => (finishGroups = resolve)));
        const nodes = vi.fn(async () => ({}));
        const preloader = createNavigationPreloader({
            host,
            loaders: { '/dashboard': dashboard, '/groups': groups, '/nodes': nodes },
        });
        preloader.start('/dashboard');
        expect(groups).not.toHaveBeenCalled();
        const pending = host.runNext();
        expect(groups).toHaveBeenCalledOnce();
        expect(nodes).not.toHaveBeenCalled();
        expect(host.callbacks.size).toBe(0);
        finishGroups({});
        await pending;
        await host.runNext();
        expect(nodes).toHaveBeenCalledOnce();
        expect(dashboard).not.toHaveBeenCalled();
        preloader.start('/nodes');
        expect(host.callbacks.size).toBe(0);
    });

    it('cancels queued work when stopped and does not continue after an in-flight import', async () => {
        const host = idleHost();
        let finishGroups;
        const groups = vi.fn(() => new Promise((resolve) => (finishGroups = resolve)));
        const nodes = vi.fn(async () => ({}));
        const preloader = createNavigationPreloader({
            host,
            loaders: { '/groups': groups, '/nodes': nodes },
        });
        preloader.start('/dashboard');
        preloader.stop();
        expect(host.callbacks.size).toBe(0);
        expect(groups).not.toHaveBeenCalled();

        preloader.start('/dashboard');
        const pending = host.runNext();
        preloader.stop();
        finishGroups({});
        await pending;
        expect(host.callbacks.size).toBe(0);
        expect(nodes).not.toHaveBeenCalled();
        preloader.start('/groups');
        await host.runNext();
        expect(groups).toHaveBeenCalledOnce();
        expect(nodes).toHaveBeenCalledOnce();
    });

    it('continues after a background failure and allows a later retry', async () => {
        const host = idleHost();
        const groups = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({});
        const nodes = vi.fn(async () => ({}));
        const preloader = createNavigationPreloader({
            host,
            loaders: { '/groups': groups, '/nodes': nodes },
        });
        preloader.start('/dashboard');
        await host.runNext();
        await host.runNext();
        expect(nodes).toHaveBeenCalledOnce();
        preloader.start('/dashboard');
        await host.runNext();
        expect(groups).toHaveBeenCalledTimes(2);
        expect(nodes).toHaveBeenCalledOnce();
    });

    it('waits for an existing import when restarted during navigation', async () => {
        const host = idleHost();
        let finishGroups;
        const groups = vi.fn(() => new Promise((resolve) => (finishGroups = resolve)));
        const nodes = vi.fn(async () => ({}));
        const preloader = createNavigationPreloader({
            host,
            loaders: { '/groups': groups, '/nodes': nodes },
        });
        preloader.start('/dashboard');
        const pending = host.runNext();
        preloader.start('/dashboard');
        expect(host.callbacks.size).toBe(0);
        finishGroups({});
        await pending;
        await host.runNext();
        expect(groups).toHaveBeenCalledOnce();
        expect(nodes).toHaveBeenCalledOnce();
    });

    it('uses a cancellable delay when idle callbacks are unavailable', async () => {
        vi.useFakeTimers();
        try {
            const loader = vi.fn(async () => ({}));
            const preloader = createNavigationPreloader({
                host: window,
                loaders: { '/groups': loader },
            });
            preloader.start('/dashboard');
            await vi.advanceTimersByTimeAsync(499);
            expect(loader).not.toHaveBeenCalled();
            preloader.stop();
            await vi.advanceTimersByTimeAsync(1000);
            expect(loader).not.toHaveBeenCalled();
            preloader.start('/dashboard');
            await vi.advanceTimersByTimeAsync(500);
            expect(loader).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });
});
