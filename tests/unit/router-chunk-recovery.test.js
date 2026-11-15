import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../../src/router/index.js';

const { handleError } = vi.hoisted(() => ({ handleError: vi.fn() }));
vi.mock('../../src/utils/errorHandler.js', () => ({ handleError }));
vi.mock('../../src/views/HomeView.vue', () => ({ default: {} }));

const failure = new Error('Failed to fetch dynamically imported module');
let removeRoute;
let originalStorage;
let reload;
beforeEach(async () => {
    sessionStorage.clear();
    handleError.mockClear();
    originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    await router.replace('/');
    removeRoute = router.addRoute({
        path: '/__failed-chunk',
        component: () => Promise.reject(failure),
    });
});

afterEach(() => {
    removeRoute();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
});

describe('router chunk recovery', () => {
    it('reloads once when its marker is persisted', async () => {
        await expect(router.push('/__failed-chunk')).rejects.toBe(failure);
        await expect(router.push('/__failed-chunk')).rejects.toBe(failure);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('misub:chunk-reload')).toBe('1');
    });

    it.each(['getter', 'read', 'write', 'dropped'])(
        'keeps the original navigation error and provides feedback on %s storage failures',
        async (mode) => {
            const real = sessionStorage;
            const storage = {
                getItem: (key) => real.getItem(key),
                setItem: (key, value) => real.setItem(key, value),
            };
            Object.defineProperty(globalThis, 'sessionStorage', {
                configurable: true,
                value: storage,
            });
            if (mode === 'getter') {
                Object.defineProperty(globalThis, 'sessionStorage', {
                    configurable: true,
                    get() {
                        throw new DOMException('Blocked', 'SecurityError');
                    },
                });
            } else if (mode === 'read') {
                vi.spyOn(storage, 'getItem').mockImplementation(() => {
                    throw new Error('Blocked');
                });
            } else if (mode === 'write') {
                vi.spyOn(storage, 'setItem').mockImplementation(() => {
                    throw new DOMException('Full', 'QuotaExceededError');
                });
            } else {
                vi.spyOn(storage, 'setItem').mockImplementation(() => {});
            }
            await expect(router.push('/__failed-chunk')).rejects.toBe(failure);
            expect(reload).not.toHaveBeenCalled();
            expect(handleError).toHaveBeenCalledWith(failure, 'Chunk Load Error', {
                recoveryBlocked: true,
            });
        }
    );
});
