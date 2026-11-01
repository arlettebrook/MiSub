// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_NAV_ITEMS } from '../../src/constants/navigation.js';
import { onRequest } from '../../functions/[[path]].js';
import { SettingsCache } from '../../functions/storage-adapter.js';
import { createSignedToken } from '../../functions/modules/auth-middleware.js';

const installationPaths = [
    '/manifest.webmanifest',
    '/icons/pwa/icon-192.png',
    '/icons/pwa/icon-512.png',
    '/icons/pwa/icon-maskable-512.png',
];
const readManifest = async () => JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));

describe('desktop installation metadata', () => {
    it('exposes a credentialed manifest link from every SPA entry', async () => {
        const source = await readFile('index.html', 'utf8');
        const link = source.match(/<link\b[^>]*\brel="manifest"[^>]*>/)?.[0];
        expect(link).toBeDefined();
        expect(link).toContain('crossorigin="use-credentials"');
        const href = link.match(/\bhref="([^"]+)"/)[1];
        for (const path of [
            '/',
            '/login',
            '/explore',
            ...MAIN_NAV_ITEMS.map((item) => item.path),
        ]) {
            expect(new URL(href, `https://misub.example${path}`).pathname).toBe(
                '/manifest.webmanifest'
            );
        }
    });

    it('keeps all navigation pages inside a standalone application scope on any deployment host', async () => {
        const manifest = await readManifest();
        expect(manifest.display).toBe('standalone');
        expect(manifest.name).toBe('MiSub');
        for (const origin of ['https://misub.example', 'https://another.example']) {
            const manifestUrl = new URL('/manifest.webmanifest', origin);
            const start = new URL(manifest.start_url, manifestUrl);
            const scope = new URL(manifest.scope, manifestUrl);
            const id = new URL(manifest.id, start);
            expect(start.origin).toBe(origin);
            expect(start.pathname).toBe('/');
            expect(id.href).toBe(start.href);
            for (const path of [
                '/',
                '/login',
                '/explore',
                ...MAIN_NAV_ITEMS.map((item) => item.path),
            ]) {
                const page = new URL(path, origin);
                expect(page.origin).toBe(scope.origin);
                expect(page.pathname.startsWith(scope.pathname)).toBe(true);
            }
        }
    });

    it('ships real PNG icons of the advertised sizes, including an adaptive Android icon', async () => {
        const manifest = await readManifest();
        const sizes = new Set();
        let hasMaskable = false;
        for (const icon of manifest.icons) {
            const file = resolve(`public${icon.src}`);
            const png = await readFile(file);
            expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
            expect(icon.type).toBe('image/png');
            const dimensions = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
            expect(icon.sizes).toBe(dimensions);
            sizes.add(dimensions);
            hasMaskable ||= icon.purpose === 'maskable';
        }
        expect(sizes).toEqual(new Set(['192x192', '512x512']));
        expect(hasMaskable).toBe(true);
    });
});

describe('installation asset access', () => {
    let settings;
    const env = { COOKIE_SECRET: 'installation-test-secret' };
    const fetchAsset = () => new Response('installation asset', { status: 200 });

    beforeEach(() => {
        settings = { disguise: { enabled: true, pageType: 'page' } };
        vi.spyOn(SettingsCache, 'get').mockImplementation(async () => settings);
    });

    afterEach(() => vi.restoreAllMocks());

    it.each(installationPaths)(
        'protects %s while disguise is enabled and the user is logged out',
        async (path) => {
            const next = vi.fn(fetchAsset);
            const response = await onRequest({
                request: new Request(`https://misub.example${path}`),
                env,
                next,
            });
            expect(response.status).toBe(404);
            expect(next).not.toHaveBeenCalled();
            expect(response.headers.get('Cache-Control')).toContain('no-cache');
        }
    );

    it.each(installationPaths)(
        'serves %s with a valid session, without redirecting to login',
        async (path) => {
            const token = await createSignedToken(env.COOKIE_SECRET, String(Date.now()));
            const next = vi.fn(fetchAsset);
            const response = await onRequest({
                request: new Request(`https://misub.example${path}`, {
                    headers: { Cookie: `auth_session=${token}` },
                }),
                env,
                next,
            });
            expect(response.status).toBe(200);
            expect(await response.text()).toBe('installation asset');
            expect(next).toHaveBeenCalledOnce();
        }
    );

    it('keeps the manifest public when disguise is disabled', async () => {
        settings.disguise.enabled = false;
        const next = vi.fn(fetchAsset);
        const response = await onRequest({
            request: new Request('https://misub.example/manifest.webmanifest'),
            env,
            next,
        });
        expect(response.status).toBe(200);
        expect(next).toHaveBeenCalledOnce();
    });
});
