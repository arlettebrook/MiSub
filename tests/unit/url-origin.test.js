import { describe, expect, it } from 'vitest';
import { isLocalHost, isSameOriginUrl } from '../../src/utils/url-origin.js';

describe('resource URL origins', () => {
    const origin = 'https://example.com';
    const baseUrl = `${origin}/dashboard/`;

    it.each([
        `${origin}/assets/app.js`,
        '/assets/app.js?v=1#chunk',
        '../assets/app.js',
        '//example.com/assets/app.js',
        'https://example.com:443/assets/app.js',
    ])('accepts same-origin URL %s', (value) => {
        expect(isSameOriginUrl(value, origin, baseUrl)).toBe(true);
    });

    it.each([
        'https://example.com.evil.test/assets/app.js',
        'https://example.com:8443/assets/app.js',
        'http://example.com/assets/app.js',
        'https://example.com@evil.test/assets/app.js',
        '//third-party.test/assets/app.js',
        'javascript:alert(1)',
        'https://[invalid-host',
        '',
        null,
        undefined,
    ])('rejects foreign, malformed or empty URL %s', (value) => {
        expect(isSameOriginUrl(value, origin, baseUrl)).toBe(false);
    });

    it.each(['localhost', '127.0.0.1', '::1', '[::1]', ' LOCALHOST '])(
        'recognizes local host %s',
        (hostname) => {
            expect(isLocalHost(hostname)).toBe(true);
        }
    );

    it.each(['example.com', 'localhost.evil.test', '', null, undefined])(
        'does not classify public or empty host %s as local',
        (hostname) => {
            expect(isLocalHost(hostname)).toBe(false);
        }
    );
});
