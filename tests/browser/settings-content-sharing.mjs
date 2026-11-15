import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_SETTINGS } from '../../src/constants/default-settings.js';

const harnessPath = '/__settings-sharing.js';
const harness = `
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createI18n } from '/src/i18n/index.js';
import SettingsView from '/src/views/SettingsView.vue';
import SettingsPanel from '/src/components/modals/SettingsPanel.vue';
import SettingsModal from '/src/components/modals/SettingsModal.vue';
import ConfirmDialog from '/src/components/ui/ConfirmDialog.vue';
import '/src/assets/main.css';
const query = new URLSearchParams(location.search);
const router = createRouter({ history: createMemoryHistory(), routes: [{ path:'/settings', component: {} }] });
await router.push(query.get('shell') === 'page' ? '/settings?focus=mytoken' : '/settings');
createApp({ setup() {
    const paused = ref(false);
    window.pauseSettings = value => paused.value = value;
    return () => h('div', { style:'margin:16px;max-width:100%' }, [
        h(query.get('shell') === 'page' ? SettingsView : query.get('shell') === 'modal' ? SettingsModal : SettingsPanel,
            { sessionPaused: paused.value, show: true }),
        h(ConfirmDialog),
    ]);
} }).use(createPinia()).use(router).use(createI18n({ initialLocale: query.get('locale') })).mount('#app');
`;
const server = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'settings-sharing-browser-test',
            resolveId: (id) => (id === harnessPath ? '\0settings-sharing' : undefined),
            load: (id) => (id === '\0settings-sharing' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use((req, res, next) => {
                    if (!req.url?.startsWith('/__settings-sharing.html')) return next();
                    res.setHeader('Content-Type', 'text/html');
                    res.end(
                        `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="${harnessPath}"></script></body></html>`
                    );
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
    for (const shell of ['page', 'panel', 'modal'])
        for (const locale of ['zh-CN', 'en-US'])
            for (const width of [1440, 390, 320]) {
                const page = await browser.newPage({ viewport: { width, height: 900 }, locale });
                const errors = [],
                    loaded = new Set(),
                    saves = [];
                let settingsReads = 0,
                    releaseCode;
                const codeGate = new Promise((resolve) => (releaseCode = resolve));
                page.on('pageerror', (error) => errors.push(error.message));
                const saved = {
                    ...structuredClone(DEFAULT_SETTINGS),
                    FileName: 'SettingsTest',
                    mytoken: 'saved-token',
                    profileToken: 'saved-profiles',
                    defaultLocale: locale,
                    customPage: { ...structuredClone(DEFAULT_SETTINGS.customPage), enabled: true },
                };
                await page.route('**/*', async (route) => {
                    const url = new URL(route.request().url());
                    if (url.origin !== base) return route.abort();
                    if (url.pathname.endsWith('/ServiceSettings.vue')) {
                        loaded.add('ServiceSettings.vue');
                        await codeGate;
                        return route.continue();
                    }
                    if (
                        url.pathname.includes('/settings/sections/') &&
                        url.pathname.endsWith('.vue')
                    )
                        loaded.add(url.pathname.split('/').pop());
                    if (!url.pathname.startsWith('/api/')) return route.continue();
                    if (url.pathname === '/api/settings') {
                        if (route.request().method() === 'GET') {
                            settingsReads++;
                            return route.fulfill({ json: saved });
                        }
                        saves.push(route.request().postDataJSON());
                        return route.fulfill({
                            json: { success: false, error: 'Synthetic save failed' },
                        });
                    }
                    return route.fulfill({ json: { success: true, data: [] } });
                });
                try {
                    await page.goto(
                        `${base}/__settings-sharing.html?shell=${shell}&locale=${locale}`
                    );
                    const token = page.locator('#setting-mytoken');
                    await token.waitFor();
                    assert.equal(await token.inputValue(), 'saved-token');
                    assert.equal(settingsReads, 1);
                    assert.ok(
                        !loaded.has('ClientSettings.vue') &&
                            !loaded.has('CustomPageSettings.vue') &&
                            !loaded.has('SystemSettings.vue')
                    );
                    const basicNode = await token.evaluate((element) => {
                        element.dataset.original = 'yes';
                        return true;
                    });
                    const labels =
                        locale === 'zh-CN'
                            ? {
                                  services: '服务集成',
                                  public: '自定义公开页',
                                  system: '系统设置',
                                  basic: '基础设置',
                                  save: '保存修改',
                                  reset: '恢复出厂设置',
                              }
                            : {
                                  services: 'Services',
                                  public: 'Public Page',
                                  system: 'System',
                                  basic: 'Basic',
                                  save: 'Save',
                                  reset: 'Factory reset',
                              };
                    const selectTab = async (label) =>
                        page
                            .locator('aside')
                            .getByRole('button', { name: label, exact: true })
                            .click();
                    await selectTab(labels.services);
                    await page.getByRole('status').filter({ visible: true }).first().waitFor();
                    releaseCode();
                    await page
                        .locator('aside button.bg-primary-600')
                        .filter({ hasText: labels.services })
                        .waitFor();
                    await page.waitForFunction(
                        () =>
                            ![...document.querySelectorAll('[role="status"]')].some(
                                (element) => element.getBoundingClientRect().height > 0
                            )
                    );
                    await selectTab(labels.public);
                    await page.waitForFunction(() =>
                        [...document.querySelectorAll('textarea')].some(
                            (element) => element.getBoundingClientRect().height > 0
                        )
                    );
                    await selectTab(labels.system);
                    const reset = page.getByRole('button', { name: labels.reset, exact: true });
                    await reset.waitFor();
                    assert.ok(
                        loaded.has('WebdavBackupSettings.vue') && loaded.has('SystemSettings.vue')
                    );
                    await reset.click();
                    const confirmation = page.locator(
                        '[role="dialog"][aria-describedby^="confirm-message-"]'
                    );
                    await confirmation.waitFor();
                    await confirmation
                        .getByRole('button', {
                            name: locale === 'zh-CN' ? '取消' : 'Cancel',
                            exact: true,
                        })
                        .click();
                    await selectTab(labels.basic);
                    await token.waitFor();
                    assert.equal(await token.getAttribute('data-original'), 'yes');
                    await token.fill('edited-token');
                    const footerSave = page
                        .locator('.settings-layout-footer')
                        .getByRole('button', { name: labels.save, exact: true });
                    await page.evaluate(() => window.pauseSettings(true));
                    await page.waitForFunction(
                        () => document.querySelector('.settings-layout-footer button').disabled
                    );
                    await page.evaluate(() => window.pauseSettings(false));
                    await page.waitForFunction(
                        () => !document.querySelector('.settings-layout-footer button').disabled
                    );
                    const saveResponse = page.waitForResponse(
                        (response) =>
                            new URL(response.url()).pathname === '/api/settings' &&
                            response.request().method() === 'POST'
                    );
                    await footerSave.click();
                    await saveResponse;
                    await page.waitForFunction(
                        () => !document.querySelector('.settings-layout-footer button').disabled
                    );
                    assert.equal(saves.length, 1);
                    assert.equal(saves[0].mytoken, 'edited-token');
                    assert.equal(await token.inputValue(), 'edited-token');
                    assert.equal(settingsReads, 1);
                    if (shell === 'page') {
                        await page.evaluate(() => window.scrollTo(0, 0));
                        await page.locator('.settings-floating-save').waitFor();
                    }
                    assert.deepEqual(errors, []);
                    assert.ok(
                        await page.evaluate(
                            () => document.documentElement.scrollWidth <= innerWidth
                        )
                    );
                    if (locale === 'en-US' && width !== 390)
                        await page.screenshot({
                            path: `tmp/settings-sharing-${shell}-${width}.png`,
                        });
                    console.log(`PASS ${shell} ${locale} ${width} shared sections/loading/save`);
                } finally {
                    releaseCode();
                    await page.close();
                }
            }
    console.log('PASS 18 Chromium scenarios for page, panel and modal');
} finally {
    await browser?.close();
    await server.close();
}
