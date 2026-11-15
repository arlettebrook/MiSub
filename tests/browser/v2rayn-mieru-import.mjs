import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { handleParseSubscription } from '../../functions/modules/parse-subscription-handler.js';
const v2rayn =
    'v2rayn://vless/' +
    Buffer.from(
        JSON.stringify({
            ConfigType: 5,
            Address: '2001:db8::1',
            Port: 443,
            Remarks: 'V2Ray Profile',
            Password: '11111111-1111-4111-8111-111111111111',
            Network: 'ws',
            StreamSecurity: 'tls',
            Sni: 'tls.example',
            TransportExtraObj: { Path: '/ws', Host: 'host.example' },
        })
    ).toString('base64url');
const mieru =
    'mierus://user:secret@edge.example?profile=default&port=8443&protocol=TCP&port=10000-10010&protocol=UDP';
const harnessPath = '/__new-format-import.js';
const harness = `
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from '/src/i18n/index.js';
import { useBulkImportLogic } from '/src/composables/useBulkImportLogic.js';
import { useDataStore } from '/src/stores/useDataStore.js';
import { isManualNodeSource, isRemoteSubscriptionSource } from '/shared/node-source.js';
createApp({ setup() {
  const store = useDataStore();
  const text = ref('');
  const bulk = useBulkImportLogic({
    addSubscriptionsFromBulk: values => values.forEach(value => store.addSubscription(value)),
    addNodesFromBulk: values => values.forEach(value => store.addSubscription(value)),
  });
  return () => h('main', { style: 'max-width:100%;overflow-wrap:anywhere' }, [
    h('textarea', { id: 'content', value: text.value, style:'width:90%;min-height:150px', onInput: e => text.value = e.target.value }),
    h('button', { id: 'import', onClick: () => bulk.handleBulkImport(text.value, 'Imported') }, 'Import'),
    h('div', { id: 'summary' }, JSON.stringify({ nodes: store.subscriptions.filter(isManualNodeSource).length, subscriptions: store.subscriptions.filter(isRemoteSubscriptionSource).length })),
    h('ul', store.subscriptions.map(value => h('li', { 'data-kind': isManualNodeSource(value) ? 'node' : 'subscription', 'data-group': value.group, 'data-url': value.url }, value.name))),
  ]);
} }).use(createPinia()).use(createI18n({ initialLocale: 'en-US' })).mount('#app');
`;
let requests = 0;
const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'v2rayn-mieru-browser-test',
            resolveId: (id) => (id === harnessPath ? '\0new-format-import' : undefined),
            load: (id) => (id === '\0new-format-import' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use(async (req, res, next) => {
                    if (req.url === '/__new-format-import.html') {
                        res.setHeader('Content-Type', 'text/html');
                        res.end(
                            `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="${harnessPath}"></script></body></html>`
                        );
                        return;
                    }
                    if (req.url !== '/api/parse_subscription') return next();
                    requests++;
                    try {
                        const chunks = [];
                        for await (const chunk of req) chunks.push(chunk);
                        const response = await handleParseSubscription(
                            new Request('http://localhost/api/parse_subscription', {
                                method: 'POST',
                                body: Buffer.concat(chunks).toString(),
                            }),
                            {}
                        );
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
try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });
    for (const width of [1440, 390, 320]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*', (route) =>
            new URL(route.request().url()).origin === base ? route.continue() : route.abort()
        );
        try {
            const initialRequests = requests;
            await page.goto(`${base}/__new-format-import.html`);
            await page
                .locator('#content')
                .fill([v2rayn, mieru, 'https://sub.example/sub?token=test'].join('\n'));
            await page.locator('#import').click();
            await page.waitForFunction(
                () =>
                    document.querySelector('#summary').textContent ===
                    '{"nodes":3,"subscriptions":1}'
            );
            assert.equal(requests, initialRequests + 1);
            assert.equal(await page.locator('li[data-kind="node"]').count(), 3);
            assert.equal(await page.locator('li[data-kind="subscription"]').count(), 1);
            assert.equal(await page.locator('li[data-group="Imported"]').count(), 4);
            const urls = await page
                .locator('li')
                .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-url')));
            assert.ok(urls.some((url) => url.startsWith('vless://')));
            assert.equal(urls.filter((url) => url.startsWith('mierus://')).length, 2);
            assert.ok(!urls.some((url) => url.startsWith('v2rayn://')));
            await page.locator('#import').click();
            await page.waitForFunction(() => document.querySelectorAll('li').length === 4);
            assert.deepEqual(errors, []);
            assert.ok(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
            );
            console.log(`PASS ${width} mixed configuration import`);
        } finally {
            await page.close();
        }
    }
    console.log('PASS 3 Chromium viewport scenarios with actual parse handler');
} finally {
    await browser?.close();
    await server.close();
}
