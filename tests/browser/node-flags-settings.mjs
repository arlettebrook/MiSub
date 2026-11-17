import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const harness = `
import { createApp, h, reactive } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from '/src/i18n/index.js';
import GlobalSettings from '/src/components/settings/sections/GlobalSettings.vue';
import NodeFlagSettings from '/src/components/settings/NodeFlagSettings.vue';
import { DEFAULT_SETTINGS } from '/src/constants/default-settings.js';
import '/src/assets/main.css';
const settings=reactive(structuredClone(DEFAULT_SETTINGS));
settings.flagEmojiMode='auto'; settings.flagEmojiPosition='suffix';
settings.regionOverrides=[{pattern:'新加坡',region:'US',flags:'i',scope:'group'}];
const profile=reactive({flagEmojiMode:'inherit',flagEmojiPosition:'inherit'});
window.flagSettings=settings;
createApp({render:()=>h('main',{class:'mx-auto max-w-5xl p-4 sm:p-6'},[
 h(GlobalSettings,{settings}),h('section',{class:'mt-6 rounded-xl border p-4'},[
 h('h2',{class:'mb-3 font-semibold'},'订阅组继承示例'),h(NodeFlagSettings,{model:profile,inherit:true,globalSettings:settings})
 ])
])}).use(createPinia()).use(createI18n({initialLocale:'zh-CN'})).mount('#app');
`;
const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'node-flags-harness',
            resolveId: (id) => (id === '/__node-flags.js' ? '\0node-flags-harness' : undefined),
            load: (id) => (id === '\0node-flags-harness' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use((request, response, next) => {
                    if (request.url !== '/__node-flags.html') return next();
                    response.setHeader('Content-Type', 'text/html');
                    response.end(
                        '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__node-flags.js"></script></body></html>'
                    );
                });
            },
        },
    ],
});
let browser;
try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' }),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.previewWorkerMessages = 0;
        const postMessage = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (...args) {
            window.previewWorkerMessages++;
            return postMessage.apply(this, args);
        };
    });
    await page.goto(`http://127.0.0.1:${port}/__node-flags.html`);
    await page.getByTestId('region-samples').fill('🇸🇬 新加坡 原生\n⚡ US-01\n🏁 Unknown');
    await page.waitForFunction(() =>
        document.querySelector('[data-testid="region-match-count"]')?.textContent.includes('1 / 3')
    );
    await page.locator('select[data-testid=region-scope]').selectOption('all');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '新加坡 原生 🇺🇸'
    );
    await page.getByTestId('flag-mode').first().selectOption('remove');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '新加坡 原生'
    );
    assert.match(await page.locator('tbody').innerText(), /🏁 Unknown/);
    await page.getByTestId('flag-mode').first().selectOption('preserve');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '🇸🇬 新加坡 原生'
    );
    await page.getByTestId('flag-mode').first().selectOption('auto');
    await page.getByTestId('flag-position').first().selectOption('prefix');
    await page.waitForFunction(() =>
        [...document.querySelectorAll('tbody tr td:nth-child(2) [aria-label]')].some(
            (element) => element.getAttribute('aria-label') === '🇺🇸 ⚡ US-01'
        )
    );
    await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0)
    );
    assert.ok(
        await page.evaluate(() => window.previewWorkerMessages > 0),
        'The preview must use a local worker'
    );
    await page.evaluate(() => {
        window.flagSettings.defaultOperators = [
            { type: 'filter', params: { exclude: { enabled: true, rules: ['Drop'] } } },
            { type: 'rename', params: { template: { enabled: true, template: '{region}' } } },
            { type: 'script', params: { dsl: [{ action: 'rename', template: '⚡ {name}' }] } },
            { type: 'rename', params: { template: { enabled: true, template: '{emoji}{name}' } } },
        ];
    });
    await page.getByTestId('region-samples').fill('US-01\nDrop\nJP-01');
    await page.waitForFunction(
        () =>
            document.querySelector('[data-testid=sample-filtered]') &&
            [...document.querySelectorAll('tbody [aria-label]')].some(
                (element) => element.getAttribute('aria-label') === '🇺🇸⚡ 美国'
            )
    );
    await page.evaluate(() => {
        window.flagSettings.defaultOperators = [];
    });
    await page.getByTestId('region-samples').fill('⚡ US/JP');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '🌍 ⚡ US/JP'
    );
    await page.getByTestId('region-choice').selectOption('JP');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '🇯🇵 ⚡ US/JP'
    );
    assert.equal(await page.evaluate(() => window.flagSettings.regionOverrides[0].scope), 'all');
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    await page.getByTestId('region-samples').fill(`🏁 ${england} Premium`);
    await page.waitForFunction(() =>
        document
            .querySelector('tbody tr td:nth-child(2) img')
            ?.getAttribute('src')
            ?.endsWith('/gb-eng.svg')
    );
    await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0)
    );
    await page.getByTestId('region-samples').fill('⚡ US/JP');
    await page.waitForFunction(
        () =>
            document
                .querySelector('tbody tr td:nth-child(2) [aria-label]')
                ?.getAttribute('aria-label') === '🇯🇵 ⚡ US/JP'
    );
    await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0)
    );
    assert.deepEqual(errors, []);
    fs.mkdirSync('tmp', { recursive: true });
    await page
        .getByTestId('region-rule-preview')
        .screenshot({ path: 'tmp/node-flags-desktop.png' });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Mobile settings must not overflow the viewport'
    );
    await page.getByTestId('region-rule-preview').screenshot({ path: 'tmp/node-flags-mobile.png' });
    console.log('Node flag settings browser checks passed at desktop and mobile sizes.');
} finally {
    await browser?.close();
    await server.close();
}
