import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import {
    handleSubscriptionNodesRequest,
    handlePublicPreviewRequest,
} from '../../functions/modules/subscription/preview-handler.js';
import {
    buildSubscriptionNodeCacheKey,
    buildSubscriptionFilterFingerprint,
} from '../../functions/services/subscription-service.js';

const source = {
    id: 'cache-source',
    name: 'Cached Source',
    url: 'https://upstream.example/sub',
    enabled: true,
    enableNodeCache: true,
};
const entry = {
    nodes: ['trojan://synthetic@cached.example:443#Cached%20Node'],
    nodeCount: 1,
    upstreamNodeCount: 1,
    sourceUrl: source.url,
    filterFingerprint: buildSubscriptionFilterFingerprint(source),
    updatedAt: '2026-11-14T12:00:00.000Z',
};
const cacheKey = buildSubscriptionNodeCacheKey(source);
const values = new Map([
    ['worker_settings_v1', JSON.stringify({ storageType: 'kv', enableFlagEmoji: false })],
    ['misub_subscriptions_v1', JSON.stringify([source])],
    [
        'misub_profiles_v1',
        JSON.stringify([
            {
                id: 'cache-profile',
                enabled: true,
                isPublic: true,
                subscriptions: [source.id],
                manualNodes: [],
            },
        ]),
    ],
    [cacheKey, JSON.stringify(entry)],
]);
let writes = 0;
const env = {
    MISUB_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => {
            writes++;
            values.set(key, value);
        },
        delete: async (key) => values.delete(key),
    },
};
let healthy = false;
let upstreamRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname !== 'upstream.example')
        throw new Error(`Unexpected upstream request: ${url}`);
    upstreamRequests.push({
        url,
        forceRefresh: options?.headers?.['Cache-Control'] === 'no-cache',
    });
    return healthy
        ? new Response('trojan://synthetic@fresh.example:443#Fresh%20Node')
        : new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
};
const harnessPath = '/__preview-cache.js';
const harness = `
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import NodePreviewModal from '/src/components/modals/NodePreview/NodePreviewModal.vue';
import { createI18n } from '/src/i18n/index.js';
import '/src/assets/main.css';
const query = new URLSearchParams(location.search);
const mode = query.get('mode');
const show = ref(true);
createApp({ render: () => h('main', [
    h('button', { id: 'reopen', onClick: () => show.value = true }, 'Reopen preview'),
    h(NodePreviewModal, { show: show.value,
        ...(mode === 'subscription' ? { subscriptionId: 'cache-source', subscriptionName: 'Cached Source' }
            : { profileId: 'cache-profile', profileName: 'Cached Profile' }),
        apiEndpoint: mode === 'public' ? '/api/public/preview' : '/api/subscription_nodes',
        'onUpdate:show': value => show.value = value,
    }),
]) }).use(createPinia()).use(createI18n({ initialLocale: query.get('locale') })).mount('#app');
`;
const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'preview-cache-browser-test',
            resolveId: (id) => (id === harnessPath ? '\0preview-cache' : undefined),
            load: (id) => (id === '\0preview-cache' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use(async (req, res, next) => {
                    if (req.url?.startsWith('/__preview-cache.html')) {
                        res.setHeader('Content-Type', 'text/html');
                        res.end(
                            `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="${harnessPath}"></script></body></html>`
                        );
                        return;
                    }
                    if (!['/api/subscription_nodes', '/api/public/preview'].includes(req.url))
                        return next();
                    try {
                        const chunks = [];
                        for await (const chunk of req) chunks.push(chunk);
                        const request = new Request(`http://localhost${req.url}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: Buffer.concat(chunks).toString(),
                        });
                        const response = await (
                            req.url === '/api/public/preview'
                                ? handlePublicPreviewRequest
                                : handleSubscriptionNodesRequest
                        )(request, env);
                        res.statusCode = response.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(await response.text());
                    } catch (error) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: error.message }));
                    }
                });
            },
        },
    ],
});
let browser;
const results = [];
try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });
    for (const mode of ['subscription', 'profile', 'public']) {
        for (const locale of ['zh-CN', 'en-US']) {
            for (const width of [1440, 390, 320]) {
                healthy = false;
                upstreamRequests = [];
                const page = await browser.newPage({
                    viewport: { width, height: 900 },
                    locale,
                    timezoneId: 'Asia/Shanghai',
                });
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await page.route('**/*', (route) =>
                    new URL(route.request().url()).origin === base
                        ? route.continue()
                        : route.abort()
                );
                try {
                    await page.goto(`${base}/__preview-cache.html?mode=${mode}&locale=${locale}`);
                    const alert = page.getByRole('alert');
                    await alert.waitFor();
                    assert.match(
                        await alert.innerText(),
                        locale === 'zh-CN' ? /保护性缓存节点/ : /protective cached nodes/
                    );
                    assert.match(await alert.innerText(), /Cached Source/);
                    assert.match(await alert.innerText(), /2026/);
                    assert.match(await alert.innerText(), /HTTP 403: Forbidden/);
                    await page.getByText('Cached Node', { exact: true }).first().waitFor();
                    assert.ok(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth
                        )
                    );
                    if (mode === 'profile' && locale === 'en-US' && width !== 390)
                        await page.screenshot({ path: `tmp/preview-cache-${width}.png` });
                    const refresh = page.getByRole('button', {
                        name: locale === 'zh-CN' ? '重新拉取节点' : 'Fetch nodes again',
                        exact: true,
                    });
                    await refresh.click();
                    await page.waitForFunction(
                        (locale) =>
                            document
                                .querySelector('[role="alert"]')
                                ?.textContent.includes(
                                    locale === 'zh-CN' ? '刷新失败' : 'Refresh failed'
                                ),
                        locale
                    );
                    assert.match(await alert.innerText(), /HTTP 403/);
                    assert.equal(upstreamRequests.at(-1).forceRefresh, true);
                    await page.getByText('Cached Node', { exact: true }).first().waitFor();
                    healthy = true;
                    await page
                        .getByRole('button', {
                            name: locale === 'zh-CN' ? '关闭' : 'Close',
                            exact: true,
                        })
                        .first()
                        .click();
                    await page.getByRole('dialog').waitFor({ state: 'hidden' });
                    await page.locator('#reopen').click();
                    await page.getByText('Fresh Node', { exact: true }).first().waitFor();
                    assert.equal(await alert.count(), 0);
                    assert.equal(upstreamRequests.length, 3);
                    assert.equal(values.get(cacheKey), JSON.stringify(entry));
                    assert.equal(writes, 0);
                    assert.deepEqual(errors, []);
                    assert.ok(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth
                        )
                    );
                    results.push({ mode, locale, width });
                    console.log(`PASS ${mode} ${locale} ${width}`);
                } finally {
                    await page.close();
                }
            }
        }
    }
    console.log(JSON.stringify({ passed: results.length, scenarios: results }, null, 2));
} finally {
    globalThis.fetch = originalFetch;
    await browser?.close();
    await server.close();
}
