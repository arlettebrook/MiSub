import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_SETTINGS } from '../../src/constants/default-settings.js';
const server = await preview({
    preview: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'http-proxy-browser-test',
            configResolved(config) {
                config.server.proxy = {};
                config.preview.proxy = {};
            },
        },
    ],
});
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const sources = [
    {
        id: 'http',
        name: 'HTTP Proxy',
        enabled: true,
        url: 'http://user:pass@203.0.113.1:8080#HTTP%20Proxy',
    },
    {
        id: 'https',
        name: 'HTTPS Proxy',
        enabled: true,
        url: 'https://[2001:db8::1]:443?sni=tls.example#HTTPS%20Proxy',
    },
    {
        id: 'subscription',
        name: 'Ordinary Subscription',
        enabled: true,
        url: 'https://sub.example:8443/sub?token=test',
        nodeCount: 1,
    },
];
let browser;
const results = [];
try {
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });
    for (const locale of ['zh-CN', 'en-US']) {
        for (const width of [1440, 390, 320]) {
            const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
            await context.addInitScript(
                (locale) => localStorage.setItem('misub:locale', locale),
                locale
            );
            const page = await context.newPage();
            const errors = [],
                external = [],
                countRequests = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('**/*', async (route) => {
                const url = new URL(route.request().url());
                if (url.origin !== base) {
                    external.push(url.hostname);
                    return route.abort();
                }
                if (!url.pathname.startsWith('/api/')) return route.continue();
                let json = { success: true, data: [] };
                if (url.pathname === '/api/data')
                    json = {
                        misubs: sources,
                        profiles: [],
                        ruleTemplates: [],
                        config: { ...DEFAULT_SETTINGS, autoUpdateInterval: 0 },
                    };
                if (url.pathname === '/api/session') json = { authenticated: true };
                if (url.pathname === '/api/public_config')
                    json = {
                        enablePublicPage: true,
                        hasCustomLoginPath: false,
                        isLoginPath: false,
                        customLoginPath: '/login',
                        disguise: { enabled: false },
                        customPage: { enabled: false },
                    };
                if (url.pathname === '/api/detect_legacy_d1')
                    json = { success: true, data: { hasLegacyData: false } };
                if (url.pathname === '/api/github/release') json = { tag_name: 'v0.0.0' };
                if (url.pathname === '/api/node_count') {
                    const payload = route.request().postDataJSON();
                    countRequests.push(payload.url);
                    json = { success: true, data: { count: 1, userInfo: null } };
                }
                await route.fulfill({ json });
            });
            try {
                await page.goto(`${base}/dashboard/nodes`);
                await page.getByText('HTTP Proxy', { exact: true }).first().waitFor();
                await page.getByText('HTTPS Proxy', { exact: true }).first().waitFor();
                assert.equal(
                    await page.getByText('Ordinary Subscription', { exact: true }).count(),
                    0
                );
                // Verify node content sizing; the site's global navigation is
                // outside this protocol compatibility regression.
                assert.ok(
                    await page
                        .locator('main')
                        .evaluate((element) => element.scrollWidth <= element.clientWidth)
                );
                if (locale === 'en-US' && width !== 390)
                    await page.screenshot({ path: `tmp/http-proxy-ui-${width}.png` });
                await page.goto(`${base}/dashboard/groups`);
                await page.getByText('Ordinary Subscription', { exact: true }).first().waitFor();
                assert.equal(await page.getByText('HTTP Proxy', { exact: true }).count(), 0);
                assert.equal(await page.getByText('HTTPS Proxy', { exact: true }).count(), 0);
                assert.ok(countRequests.every((url) => url === sources[2].url));
                assert.ok(!external.includes('203.0.113.1') && !external.includes('[2001:db8::1]'));
                assert.deepEqual(errors, []);
                results.push({ locale, width });
                console.log(`PASS ${locale} ${width}`);
            } finally {
                await context.close();
            }
        }
    }
    console.log(JSON.stringify({ passed: results.length, scenarios: results }, null, 2));
} finally {
    await browser?.close();
    server.httpServer.closeAllConnections();
    await new Promise((resolve) => server.httpServer.close(resolve));
}
