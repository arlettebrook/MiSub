import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const harnessPath = '/__modal-loading.js';
const harness = `
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from '/src/i18n/index.js';
import { createLazyModal } from '/src/utils/lazy-modal.js';
import { useLazyModals } from '/src/composables/useLazyModals.js';
import '/src/assets/main.css';
const Logs = createLazyModal('LogModal');
const Preview = createLazyModal('NodePreviewModal');
createApp({ setup() {
    const logs = ref(false), preview = ref(false);
    const mounted = useLazyModals({ logs, preview });
    return () => h('main', [
        h('button', { id: 'open-logs', onClick: () => logs.value = true }, 'Open logs'),
        h('button', { id: 'open-preview', onClick: () => preview.value = true }, 'Open preview'),
        mounted.has('logs') && h(Logs, { show: logs.value, 'onUpdate:show': value => logs.value = value }),
        mounted.has('preview') && h(Preview, { show: preview.value, subscriptionId: 'source', subscriptionName: 'Test source', 'onUpdate:show': value => preview.value = value }),
    ]);
} }).use(createPinia()).use(createI18n({ initialLocale: 'en-US' })).mount('#app');
`;
const server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [
        {
            name: 'modal-loading-harness',
            resolveId: (id) => (id === harnessPath ? '\0modal-loading' : undefined),
            load: (id) => (id === '\0modal-loading' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use((request, response, next) => {
                    if (request.url !== '/__modal-loading.html') return next();
                    response.setHeader('Content-Type', 'text/html');
                    response.end(
                        `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="${harnessPath}"></script></body></html>`
                    );
                });
            },
        },
    ],
});

let browser;
try {
    await server.listen();
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let releaseCode;
        const codeGate = new Promise((resolve) => (releaseCode = resolve));
        await page.route('**/src/components/modals/LogModal.vue*', async (route) => {
            await codeGate;
            await route.continue();
        });
        let logRequests = 0;
        let releaseData;
        await page.route('**/api/logs*', async (route) => {
            logRequests++;
            const requestNumber = logRequests;
            await new Promise((resolve) => (releaseData = resolve));
            await route.fulfill({
                json: {
                    data: [
                        {
                            id: String(requestNumber),
                            profileName: requestNumber === 1 ? 'Previous log' : 'Updated log',
                            timestamp: Date.now(),
                            status: 'success',
                            userAgent: 'test',
                        },
                    ],
                },
            });
        });
        await page.route('**/api/subscription_nodes', (route) =>
            route.fulfill({
                json: {
                    success: true,
                    nodes: [
                        {
                            name: 'Demo node',
                            protocol: 'vless',
                            server: 'example.com',
                            port: 443,
                            url: 'vless://test@example.com:443#Demo',
                        },
                    ],
                    stats: { protocols: { vless: 1 }, regions: {} },
                },
            })
        );
        await page.goto(`${server.resolvedUrls.local[0]}__modal-loading.html`);
        await page.locator('#open-logs').click();
        await page.locator('[data-testid="modal-code-loading"]').waitFor();
        assert.equal(logRequests, 0, 'Data requests must wait until the dialog module is ready');
        assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).count(), 2);
        assert.equal(await page.evaluate(() => document.body.style.position), 'fixed');
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true
        );
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        releaseCode();
        await page.waitForFunction(
            () => performance.getEntriesByName('misub:code:LogModal').length > 0
        );
        assert.equal(logRequests, 0, 'Cancelling during code loading must not fetch logs');
        await page.locator('#open-logs').click();
        await page.getByText('Fetching logs…', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-testid="modal-code-loading"]').count(), 0);
        releaseData();
        await page.getByText('Previous log', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close', exact: true }).first().click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.locator('#open-logs').click();
        await page
            .getByText('Refreshing logs; showing the previous result…', { exact: true })
            .waitFor();
        assert.equal(await page.getByText('Previous log', { exact: true }).count(), 1);
        releaseData();
        await page.getByText('Updated log', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.locator('#open-preview').click();
        await page.getByText('Demo node', { exact: true }).first().waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'open-preview');
        const timings = await page.evaluate(() =>
            performance
                .getEntriesByType('measure')
                .filter((entry) => entry.name.startsWith('misub:'))
                .map((entry) => entry.name)
        );
        for (const name of [
            'misub:code:LogModal',
            'misub:data:logs',
            'misub:code:NodePreviewModal',
            'misub:data:node-preview',
        ])
            assert.ok(timings.includes(name));
        assert.deepEqual(errors, []);
        console.log(
            `PASS immediate shell, cancellable loading, retained logs and timings width=${width}`
        );
        await page.close();
    }
} finally {
    await browser?.close();
    await server.close();
}
