import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isValidCustomLoginPath,
    normalizeLoginPath,
    readRememberedLoginPath,
} from '../../src/utils/login-path.js';

afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('isValidCustomLoginPath', () => {
    it('treats login as the default path instead of a custom-only route', () => {
        expect(isValidCustomLoginPath('login')).toBe(false);
        expect(isValidCustomLoginPath('/login')).toBe(false);
        expect(isValidCustomLoginPath(' /login ')).toBe(false);
    });

    it('rejects empty and slash-only values', () => {
        expect(isValidCustomLoginPath('')).toBe(false);
        expect(isValidCustomLoginPath('/')).toBe(false);
        expect(isValidCustomLoginPath('   ')).toBe(false);
    });

    it('accepts non-login custom paths', () => {
        expect(isValidCustomLoginPath('admin-login')).toBe(true);
        expect(isValidCustomLoginPath('/admin-login')).toBe(true);
    });

    it('normalizes custom and default entries consistently', () => {
        expect(normalizeLoginPath(' /admin-login ')).toBe('/admin-login');
        expect(normalizeLoginPath('///')).toBe('/login');
        expect(normalizeLoginPath(null)).toBe('/login');
    });

    it.each([
        '//foreign.test',
        '/\\foreign.test',
        '/admin-login?redirect=evil',
        'https://foreign.test',
    ])('rejects unsafe remembered entry %s', (path) => {
        sessionStorage.setItem('misub:login-path', path);
        expect(readRememberedLoginPath()).toBe('/login');
    });

    it('restores a confirmed local entry and handles blocked storage', () => {
        sessionStorage.setItem('misub:login-path', '/admin-login');
        expect(readRememberedLoginPath()).toBe('/admin-login');
        vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        expect(readRememberedLoginPath()).toBe('/login');
    });
});
