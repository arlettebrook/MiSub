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
        let releasePreviewCode;
        const previewCodeGate = new Promise((resolve) => (releasePreviewCode = resolve));
        await page.route(
            '**/src/components/modals/NodePreview/NodePreviewModal.vue*',
            async (route) => {
                await previewCodeGate;
                await route.continue();
            }
        );
        let logRequests = 0;
        let releaseData;
        await page.route('**/api/logs*', async (route) => {
            logRequests++;
            const requestNumber = logRequests;
            await new Promise((resolve) => (releaseData = resolve));
            await route
                .fulfill({
                    json: {
                        data: [
                            {
                                id: String(requestNumber),
                                profileName: requestNumber <= 2 ? 'Previous log' : 'Updated log',
                                timestamp: Date.now(),
                                status: 'success',
                                userAgent: 'test',
                            },
                        ],
                    },
                })
                .catch((error) => {
                    if (requestNumber !== 1) throw error;
                });
        });
        let previewRequests = 0;
        await page.route('**/api/subscription_nodes', (route) => {
            previewRequests++;
            return route.fulfill({
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
            });
        });
        await page.goto(`${server.resolvedUrls.local[0]}__modal-loading.html`);
        const firstLogRequest = page.waitForRequest('**/api/logs*');
        await page.locator('#open-logs').click();
        await firstLogRequest;
        await page.locator('[data-testid="modal-code-loading"]').waitFor();
        assert.equal(
            logRequests,
            1,
            'Data requests must start while the dialog code is still pending'
        );
        assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).count(), 2);
        assert.equal(await page.evaluate(() => document.body.style.position), 'fixed');
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true
        );
        const ring = page.locator('.loading-ring');
        await ring.waitFor();
        assert.match(
            await ring.evaluate((element) => getComputedStyle(element).animationName),
            /^loading-orbit(?:-|$)/
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
            await ring.evaluate((element) => getComputedStyle(element).animationName),
            'none'
        );
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        if (process.env.MODAL_LOADING_SCREENSHOT) {
            await page
                .locator('[role="dialog"] > div')
                .screenshot({ path: `${process.env.MODAL_LOADING_SCREENSHOT}-${width}-light.png` });
            await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page
                .locator('[role="dialog"] > div')
                .screenshot({ path: `${process.env.MODAL_LOADING_SCREENSHOT}-${width}-dark.png` });
            await page.evaluate(() => document.documentElement.classList.remove('dark'));
        }
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => performance.getEntriesByName('misub:data:logs').length > 0
        );
        releaseData();
        releaseCode();
        await page.waitForFunction(
            () => performance.getEntriesByName('misub:code:LogModal').length > 0
        );
        assert.equal(
            logRequests,
            1,
            'Cancelling during code loading must not restart the data request'
        );
        await page.locator('#open-logs').click();
        await page.getByText('Fetching logs…', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-testid="modal-code-loading"]').count(), 0);
        releaseData();
        await page.getByText('Previous log', { exact: true }).waitFor();
        assert.equal(logRequests, 2);
        await page.getByRole('button', { name: 'Close', exact: true }).first().click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.locator('#open-logs').click();
        await page.getByText('Previous log', { exact: true }).waitFor();
        assert.equal(logRequests, 2, 'Reopening fresh logs must reuse the recent result');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page
            .getByText('Refreshing logs; showing the previous result…', { exact: true })
            .waitFor();
        assert.equal(await page.getByText('Previous log', { exact: true }).count(), 1);
        releaseData();
        await page.getByText('Updated log', { exact: true }).waitFor();
        assert.equal(logRequests, 3, 'Manual refresh must bypass the recent result');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.locator('#open-preview').click();
        await page.getByRole('dialog').waitFor();
        await page.evaluate(() => {
            window.previewBackdrop = document.querySelector('[role="dialog"]');
            window.previewPanel = window.previewBackdrop.querySelector('[tabindex="-1"]');
            window.previewTitleId = window.previewBackdrop.getAttribute('aria-labelledby');
            window.previewWidth = window.previewPanel.offsetWidth;
        });
        await page.locator('.loading-ring').waitFor();
        assert.equal(previewRequests, 1, 'Preview data must load before the preview code is ready');
        releasePreviewCode();
        await page.getByText('Demo node', { exact: true }).first().waitFor();
        assert.equal(previewRequests, 1, 'The loaded preview must adopt its existing request');
        assert.equal(
            await page.evaluate(
                () => document.querySelector('[role="dialog"]') === window.previewBackdrop
            ),
            true
        );
        assert.equal(
            await page.evaluate(
                () =>
                    document.querySelector('[role="dialog"] [tabindex="-1"]') ===
                    window.previewPanel
            ),
            true
        );
        assert.equal(
            await page.evaluate(
                () =>
                    window.previewBackdrop.getAttribute('aria-labelledby') === window.previewTitleId
            ),
            true
        );
        // Wait for the original entrance transition before comparing the final width.
        await page.waitForFunction(
            () => !window.previewPanel.classList.contains('modal-inner-enter-active')
        );
        assert.equal(
            await page.evaluate(() =>
                Math.round(window.previewPanel.getBoundingClientRect().width)
            ),
            await page.evaluate(() => Math.round(window.previewWidth))
        );
        assert.equal(await page.evaluate(() => document.body.style.position), 'fixed');
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
