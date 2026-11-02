import { describe, expect, it } from 'vitest';
import { isAppScriptError, isForeignRejection } from '../../src/utils/error-source.js';

const ORIGIN = 'https://misub.example.com';
const rejectionFrom = (location, message = 'boom') => ({
    message,
    stack: `Error: ${message}\n    at update (${location}:1:10)`,
});

describe('runtime error sources', () => {
    it.each([
        `${ORIGIN}/assets/index.js`,
        '/assets/index.js',
        'assets/index.js',
        `blob:${ORIGIN}/generated-script`,
    ])('preserves application scripts at %s', (filename) => {
        expect(isAppScriptError({ filename, message: 'boom' }, ORIGIN)).toBe(true);
    });

    it.each([
        'chrome-extension://abc/content_main.js',
        'moz-extension://abc/inject.js',
        'safari-web-extension://abc/script.js',
        'safari-extension://abc/script.js',
        'VM144',
        'VM144:2',
        'about:blank',
        'data:text/javascript,throw%201',
        'https://third-party.test/analytics.js',
        'blob:https://third-party.test/abc',
    ])('filters foreign scripts at %s', (filename) => {
        expect(isAppScriptError({ filename, message: 'boom' }, ORIGIN)).toBe(false);
    });

    it('filters opaque errors while preserving specific errors without a filename', () => {
        expect(isAppScriptError({ message: 'Script error.' }, ORIGIN)).toBe(false);
        expect(isAppScriptError({ message: 'Cannot read properties of undefined' }, ORIGIN)).toBe(
            true
        );
        expect(
            isAppScriptError({ filename: `${ORIGIN}/app.js`, message: 'Script error.' }, ORIGIN)
        ).toBe(true);
    });

    it('preserves sources that cannot be parsed', () => {
        expect(isAppScriptError({ filename: 'https://[' }, ORIGIN)).toBe(true);
    });

    it('uses the current window origin by default', () => {
        expect(isAppScriptError({ filename: `${window.location.origin}/app.js` })).toBe(true);
    });
});

describe('promise rejection sources', () => {
    it.each([
        'chrome-extension://abc/content_main.js',
        'moz-extension://abc/inject.js',
        'safari-web-extension://abc/script.js',
        'VM144',
        'about:blank',
        'https://third-party.test/analytics.js',
    ])('filters rejections originating at %s', (location) => {
        expect(isForeignRejection(rejectionFrom(location), ORIGIN)).toBe(true);
    });

    it('recognizes Firefox stack frames', () => {
        expect(
            isForeignRejection({ stack: 'update@https://third-party.test/app.js:2:10' }, ORIGIN)
        ).toBe(true);
        expect(isForeignRejection({ stack: `update@${ORIGIN}/app.js:2:10` }, ORIGIN)).toBe(false);
    });

    it.each(['chrome-extension://abc/inject.js', 'VM144', 'https://third-party.test/sdk.js'])(
        'preserves a mixed stack with application code and %s',
        (foreignLocation) => {
            const reason = rejectionFrom(foreignLocation);
            reason.stack += `\n    at save (${ORIGIN}/assets/index.js:1:10)`;
            expect(isForeignRejection(reason, ORIGIN)).toBe(false);
        }
    );

    it('preserves same-origin generated blob scripts', () => {
        expect(isForeignRejection(rejectionFrom(`blob:${ORIGIN}/abc`), ORIGIN)).toBe(false);
    });

    it('does not classify an error by a URL in its message', () => {
        const reason = { message: 'Failed at https://third-party.test/api' };
        reason.stack = `Error: ${reason.message}`;
        expect(isForeignRejection(reason, ORIGIN)).toBe(false);
        expect(
            isForeignRejection({ stack: 'Error: chrome-extension://abc/inject.js' }, ORIGIN)
        ).toBe(false);
    });

    it.each([undefined, null, 'request failed', { message: 'boom' }, { stack: 'Error: boom' }])(
        'preserves rejection reasons with unknown sources: %j',
        (reason) => {
            expect(isForeignRejection(reason, ORIGIN)).toBe(false);
        }
    );

    it('preserves unparseable stack URLs', () => {
        expect(isForeignRejection(rejectionFrom('https://['), ORIGIN)).toBe(false);
    });

    it('filters opaque cross-origin rejections', () => {
        expect(isForeignRejection({ message: 'Script error.' }, ORIGIN)).toBe(true);
        expect(isForeignRejection('Script error.', ORIGIN)).toBe(true);
    });
});
