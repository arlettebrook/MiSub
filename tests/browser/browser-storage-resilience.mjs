import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_SETTINGS } from '../../src/constants/default-settings.js';

// Test production output: Pinia's development tools also access browser storage.
// Run npm run build before this script.
const server = await preview({
    preview: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'storage-test-disable-proxy',
            configResolved(config) {
                config.server.proxy = {};
                config.preview.proxy = {};
            },
        },
    ],
});
const nodes = Array.from({ length: 70 }, (_, index) => ({
    id: `node-${index}`,
    name: `Node ${index}`,
    enabled: true,
    url: `trojan://synthetic@node${index}.example:443#Node%20${index}`,
}));
const results = [];
function record(result) {
    results.push(result);
    console.log(`PASS ${result.scenario}`);
}
let browser;

async function createPage(mode, authenticated) {
    const context = await browser.newContext({ locale: 'zh-CN' });
    await context.addInitScript((mode) => {
        if (mode === 'getter') {
            for (const name of ['localStorage', 'sessionStorage']) {
                Object.defineProperty(window, name, {
                    get() {
                        const error = new DOMException('Blocked', 'SecurityError');
                        error.stack = new Error(`Blocked ${name}`).stack;
                        throw error;
                    },
                });
            }
        } else if (mode === 'quota') {
            Storage.prototype.setItem = () => {
                throw new DOMException('Full', 'QuotaExceededError');
            };
        } else if (mode === 'dropped') {
            Storage.prototype.setItem = () => {};
        }
    }, mode);
    const page = await context.newPage();
    const errors = [];
    let documents = 0;
    page.on('pageerror', (error) => {
        errors.push(error.message);
        console.error(error.stack);
    });
    page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
    });
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== baseUrl) return route.abort();
        if (url.pathname === '/assets/storage-failure.js')
            return route.fulfill({ status: 404, contentType: 'text/javascript', body: '' });
        if (!url.pathname.startsWith('/api/')) return route.continue();
        let json = { success: true, data: [] };
        if (url.pathname === '/api/data')
            json = authenticated
                ? { misubs: nodes, profiles: [], ruleTemplates: [], config: DEFAULT_SETTINGS }
                : { authenticated: false };
        if (url.pathname === '/api/session') json = { authenticated };
        if (url.pathname === '/api/public_config')
            json = {
                enablePublicPage: true,
                isLoginPath: false,
                hasCustomLoginPath: false,
                customLoginPath: '/login',
                disguise: { enabled: false },
                customPage: { enabled: false },
            };
        if (url.pathname === '/api/public/profiles')
            json = {
                success: true,
                data: [],
                config: {
                    announcement: {
                        enabled: true,
                        dismissible: true,
                        updatedAt: 'storage-test',
                        content: 'Storage regression announcement',
                    },
                },
            };
        if (url.pathname === '/api/detect_legacy_d1')
            json = { success: true, hasLegacyData: false };
        if (url.pathname === '/api/github/release') json = { tag_name: 'v0.0.0' };
        await route.fulfill({ json });
    });
    return { context, page, errors, documents: () => documents };
}

let baseUrl;
try {
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });

    for (const mode of ['getter', 'quota', 'dropped']) {
        const { context, page, errors, documents } = await createPage(mode, true);
        try {
            await page.goto(`${baseUrl}/dashboard/nodes`);
            await page.getByText('Node 0', { exact: true }).first().waitFor();
            const names = page.getByText(/^Node \d+$/, { exact: true });
            const pageSize = page.locator('.panel-pagination-shell select');
            assert.equal(await pageSize.inputValue(), '24');
            assert.equal(await names.count(), 24);
            await page.getByRole('button', { name: '下一页', exact: true }).click();
            await page.getByText('Node 24', { exact: true }).first().waitFor();
            await pageSize.selectOption('48');
            await page.getByText('Node 0', { exact: true }).first().waitFor();
            assert.equal(await names.count(), 48);
            assert.equal(
                await page.getByRole('spinbutton', { name: '页码', exact: true }).inputValue(),
                '1'
            );
            await page.getByRole('button', { name: '列表视图', exact: true }).click();
            await page.getByRole('button', { name: '切换到 English', exact: true }).first().click();
            await page.waitForFunction(() => document.documentElement.lang === 'en-US');
            assert.deepEqual(errors, []);
            assert.equal(documents(), 1);
            record({
                scenario: `startup-${mode}`,
                documents: documents(),
                defaultPageSize: 24,
                changedPageSize: 48,
            });
        } catch (error) {
            console.error(
                JSON.stringify({
                    errors,
                    url: page.url(),
                    body: await page.locator('body').innerText(),
                })
            );
            throw error;
        } finally {
            await context.close();
        }
    }

    for (const kind of ['chunk', 'asset']) {
        for (const mode of ['normal', 'getter', 'quota', 'dropped']) {
            const { context, page, errors, documents } = await createPage(mode, false);
            try {
                await context.addInitScript((kind) => {
                    const interval = setInterval(() => {
                        if (
                            !window.errorHandler ||
                            !document.querySelector('#app')?.children.length
                        )
                            return;
                        clearInterval(interval);
                        setInterval(() => {
                            if (kind === 'chunk') {
                                import('/assets/storage-failure.js');
                            } else {
                                const script = document.createElement('script');
                                script.src = '/assets/storage-failure.js';
                                document.body.appendChild(script);
                            }
                        }, 250);
                    }, 25);
                }, kind);
                await page.goto(baseUrl);
                const expected = mode === 'normal' ? 2 : 1;
                if (mode === 'normal') {
                    await page.waitForFunction(
                        (key) => sessionStorage.getItem(key) === '1',
                        `misub:${kind === 'chunk' ? 'chunk' : 'asset'}-reload`
                    );
                } else {
                    await page.waitForFunction(
                        () => window.errorHandler?.getErrorStats().totalErrors >= 3
                    );
                }
                if (mode !== 'normal')
                    await page
                        .getByText(/请手动刷新页面后重试/)
                        .first()
                        .waitFor();
                // Keep failing for another second to detect loops across documents.
                await page.waitForTimeout(1000);
                assert.equal(documents(), expected, `${kind}/${mode} document requests`);
                assert.deepEqual(errors, []);
                record({ scenario: `${kind}-${mode}`, documents: documents() });
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
