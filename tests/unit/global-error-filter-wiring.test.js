import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { handleError, reload } = vi.hoisted(() => ({ handleError: vi.fn(), reload: vi.fn() }));

vi.mock('vue', async () => ({
    ...(await vi.importActual('vue')),
    createApp: () => ({ config: {}, use: vi.fn(), mount: vi.fn() }),
}));
vi.mock('../../src/App.vue', () => ({ default: {} }));
vi.mock('../../src/router', () => ({ default: {} }));
vi.mock('../../src/i18n/index.js', () => ({ i18n: {} }));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast: vi.fn() }) }));
vi.mock('../../src/utils/errorHandler.js', () => ({
    handleError,
    setToastHandler: vi.fn(),
    configureErrorMonitoring: vi.fn(),
}));

let listeners;
let originalUrl;
beforeAll(async () => {
    originalUrl = window.location.href;
    window.happyDOM.setURL('https://misub.example/dashboard');
    const registration = vi.spyOn(window, 'addEventListener');
    await import('../../src/main.js');
    listeners = registration.mock.calls.slice();
    registration.mockRestore();
});

beforeEach(() => {
    handleError.mockClear();
    sessionStorage.clear();
    vi.spyOn(window.location, 'reload').mockImplementation(reload);
    reload.mockClear();
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
    for (const [type, callback, options] of listeners) {
        window.removeEventListener(type, callback, options);
    }
    window.happyDOM.setURL(originalUrl);
    vi.restoreAllMocks();
});

const rejection = (reason) => {
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(event, 'reason', { value: reason });
    window.dispatchEvent(event);
    return event;
};

const errorFrom = (url, message = 'boom') =>
    Object.assign(new Error(message), {
        stack: `Error: ${message}\n    at update (${url}:1:10)`,
    });

const runtimeError = (info) => {
    const event = new ErrorEvent('error', { cancelable: true, ...info });
    // happy-dom 的事件 target 是内部 Window 包装对象；直接传入真实全局对象。
    Object.defineProperty(event, 'target', { value: window });
    listeners.find(([type, , options]) => type === 'error' && !options)[1](event);
    return event;
};

const resourceError = async (resourceUrl, tagName = 'SCRIPT') => {
    listeners.find(([type, , options]) => type === 'error' && options === true)[1]({
        target: { src: resourceUrl, tagName },
    });
    await Promise.resolve();
};

describe('global error filtering', () => {
    it.each([
        'chrome-extension://abc/content_main.js',
        'https://third-party.test/analytics.js',
        'VM144',
    ])('ignores runtime errors from %s', (filename) => {
        const event = runtimeError({ filename, message: 'boom' });
        expect(handleError).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    it('ignores opaque cross-origin runtime errors', () => {
        runtimeError({ message: 'Script error.' });
        expect(handleError).not.toHaveBeenCalled();
    });

    it('reports same-origin runtime errors', () => {
        const error = new Error('application failure');
        runtimeError({
            filename: `${window.location.origin}/assets/index.js`,
            message: error.message,
            error,
        });
        expect(handleError).toHaveBeenCalledTimes(1);
        expect(handleError).toHaveBeenCalledWith(
            error,
            'Global JavaScript Error',
            expect.any(Object)
        );
    });

    it.each([
        'chrome-extension://abc/content_main.js',
        'https://third-party.test/analytics.js',
        'VM144',
    ])('ignores promise rejections from %s', (url) => {
        const event = rejection(errorFrom(url));
        expect(handleError).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    it('reports same-origin promise rejections', () => {
        const reason = errorFrom(`${window.location.origin}/assets/index.js`);
        rejection(reason);
        expect(handleError).toHaveBeenCalledTimes(1);
        expect(handleError).toHaveBeenCalledWith(
            reason,
            'Unhandled Promise Rejection',
            expect.any(Object)
        );
    });

    it('reports promise rejections whose origin is unknown', () => {
        rejection({ message: 'application failure' });
        expect(handleError).toHaveBeenCalledTimes(1);
    });

    it('filters a foreign chunk error before attempting to reload the application', () => {
        rejection(
            errorFrom(
                'chrome-extension://abc/index.js',
                'Failed to fetch dynamically imported module'
            )
        );
        expect(reload).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('misub:chunk-reload')).toBeNull();
        expect(handleError).not.toHaveBeenCalled();
    });

    it('preserves the one-time reload for application chunk failures', () => {
        const reason = errorFrom(
            `${window.location.origin}/assets/index.js`,
            'Failed to fetch dynamically imported module'
        );
        rejection(reason);
        rejection(reason);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('misub:chunk-reload')).toBe('1');
    });

    it('reports a same-origin resource failure without throwing another error', async () => {
        const resourceUrl = `${window.location.origin}/images/logo.png`;
        await resourceError(resourceUrl, 'IMG');
        expect(handleError).toHaveBeenCalledWith(
            expect.objectContaining({ message: `Resource load failed: ${resourceUrl}` }),
            'Resource Load Error',
            { tagName: 'IMG', src: resourceUrl }
        );
    });

    it.each([
        'https://misub.example.evil.test/assets/app.js',
        'https://misub.example:8443/assets/app.js',
        'https://third-party.test/assets/app.js',
    ])('ignores foreign resource %s without reloading', async (resourceUrl) => {
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
        await resourceError(resourceUrl);
        expect(replace).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('misub:asset-reload')).toBeNull();
        expect(handleError).not.toHaveBeenCalled();
    });

    it.each(['/assets/app.js?v=1#chunk', '/assets/app.css#styles'])(
        'recovers a relative asset URL %s only once',
        async (resourceUrl) => {
            const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
            await resourceError(resourceUrl);
            expect(replace).toHaveBeenCalledTimes(1);
            expect(new URL(replace.mock.calls[0][0]).searchParams.has('__misub_reload')).toBe(true);
            expect(sessionStorage.getItem('misub:asset-reload')).toBe('1');
            expect(handleError).not.toHaveBeenCalled();

            await resourceError(resourceUrl);
            expect(replace).toHaveBeenCalledTimes(1);
            expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Resource Load Error', {
                tagName: 'SCRIPT',
                src: resourceUrl,
            });
        }
    );

    it.each(['localhost', '[::1]'])(
        'suppresses repeated local asset failures on %s while reporting other resources',
        async (hostname) => {
            const publicUrl = window.location.href;
            window.happyDOM.setURL(`http://${hostname}/dashboard`);
            vi.resetModules();
            const registration = vi.spyOn(window, 'addEventListener');
            let localListeners = [];
            try {
                await import('../../src/main.js');
                localListeners = registration.mock.calls.slice();
                const handler = localListeners.find(
                    ([type, , options]) => type === 'error' && options === true
                )[1];
                sessionStorage.setItem('misub:asset-reload', '1');
                const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
                handler({ target: { src: '/assets/app.js?v=1#chunk', tagName: 'SCRIPT' } });
                await Promise.resolve();
                expect(replace).not.toHaveBeenCalled();
                expect(handleError).not.toHaveBeenCalled();

                handler({ target: { src: '/images/logo.png', tagName: 'IMG' } });
                await Promise.resolve();
                expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Resource Load Error', {
                    tagName: 'IMG',
                    src: '/images/logo.png',
                });
            } finally {
                for (const [type, callback, options] of localListeners) {
                    window.removeEventListener(type, callback, options);
                }
                registration.mockRestore();
                window.happyDOM.setURL(publicUrl);
            }
        }
    );
});
