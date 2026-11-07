import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const harnessPath = '/__node-preview-scroll.js';
const harness = `
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import NodePreviewModal from '/src/components/modals/NodePreview/NodePreviewModal.vue';
import { createI18n } from '/src/i18n/index.js';
import '/src/assets/main.css';
const show = ref(true);
const profile = new URLSearchParams(location.search).has('profile');
document.body.style.minHeight = '2400px';
window.scrollTo(0, 300);
window.initialScrollPosition = window.scrollY;
createApp({ render: () => h(NodePreviewModal, {
  show: show.value,
  ...(profile ? { profileId: 'profile', profileName: 'Test Profile' }
    : { subscriptionId: 'subscription', subscriptionName: 'Test Subscription' }),
  'onUpdate:show': value => show.value = value,
}) }).use(createPinia()).use(createI18n({ initialLocale: 'zh-CN' })).mount('#app');
`;

const server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [
        {
            name: 'node-preview-scroll-harness',
            resolveId: (id) => (id === harnessPath ? '\0node-preview-scroll' : undefined),
            load: (id) => (id === '\0node-preview-scroll' ? harness : undefined),
            configureServer(vite) {
                vite.middlewares.use((request, response, next) => {
                    if (request.url?.split('?')[0] !== '/__node-preview-scroll.html') return next();
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
    const nodes = Array.from({ length: 60 }, (_, index) => ({
        name: `Node ${index + 1}`,
        protocol: 'vless',
        server: 'example.com',
        port: 443,
        region: '香港',
        url: `vless://test-${index}@example.com:443#Node${index + 1}`,
    }));

    for (const profile of [false, true]) {
        for (const viewport of [
            { width: 1440, height: 900 },
            { width: 390, height: 844 },
        ]) {
            const page = await browser.newPage({ viewport });
            await page.route('**/api/**', (route) =>
                route.fulfill({
                    json: {
                        success: true,
                        nodes,
                        stats: { protocols: { vless: 60 }, regions: { 香港: 60 } },
                    },
                })
            );
            await page.goto(
                `${server.resolvedUrls.local[0]}__node-preview-scroll.html${profile ? '?profile=1' : ''}`
            );
            await page
                .getByText(profile ? '订阅组节点概览' : '订阅节点预览结果', { exact: true })
                .waitFor();
            const modes = viewport.width >= 1024 ? ['list', 'card'] : ['card'];
            for (const mode of modes) {
                if (viewport.width >= 1024)
                    await page
                        .getByRole('button', {
                            name: mode === 'list' ? '列表视图' : '卡片视图',
                            exact: true,
                        })
                        .click();
                const row = page
                    .getByText('Node 1', { exact: true })
                    .filter({ visible: true })
                    .first();
                await row.scrollIntoViewIfNeeded();
                const box = await row.boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                const positions = () =>
                    row.evaluate((element) => {
                        const result = [];
                        for (let parent = element; parent; parent = parent.parentElement)
                            result.push(parent.scrollTop);
                        return result;
                    });
                const before = await positions();
                const pagePosition = await page.evaluate(() => scrollY);
                await page.mouse.wheel(0, 320);
                await page.waitForTimeout(350);
                const after = await positions();
                const changed = after.some((value, index) => value > before[index]);
                if (!changed)
                    console.error(
                        await row.evaluate((element) => {
                            const result = [];
                            for (let parent = element; parent; parent = parent.parentElement)
                                result.push({
                                    tag: parent.tagName,
                                    classes: parent.className,
                                    overflow: getComputedStyle(parent).overflowY,
                                    height: parent.clientHeight,
                                    content: parent.scrollHeight,
                                    top: parent.scrollTop,
                                });
                            return result;
                        })
                    );
                assert.ok(
                    changed,
                    `Wheel scrolling failed: profile=${profile}, width=${viewport.width}, mode=${mode}`
                );
                assert.equal(
                    await page.evaluate(() => scrollY),
                    pagePosition,
                    'Background must remain locked'
                );
                const lastRow = page
                    .getByText('Node 24', { exact: true })
                    .filter({ visible: true })
                    .first();
                await lastRow.scrollIntoViewIfNeeded();
                assert.ok(
                    await lastRow.evaluate((element) => {
                        const rect = element.getBoundingClientRect();
                        for (
                            let parent = element.parentElement;
                            parent;
                            parent = parent.parentElement
                        ) {
                            if (getComputedStyle(parent).overflowY === 'auto') {
                                const bounds = parent.getBoundingClientRect();
                                return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
                            }
                        }
                        return false;
                    }),
                    'The last node on the page must be reachable without clipping'
                );
                if (
                    process.env.NODE_PREVIEW_SCREENSHOT &&
                    profile &&
                    viewport.width === 1440 &&
                    mode === 'list'
                ) {
                    await page.screenshot({ path: process.env.NODE_PREVIEW_SCREENSHOT });
                }
                const lastPositions = await positions();
                await page.mouse.move(8, 8);
                await page.mouse.wheel(0, 320);
                await page.waitForTimeout(150);
                assert.deepEqual(
                    await positions(),
                    lastPositions,
                    'Backdrop wheel must not scroll the dialog'
                );
                assert.equal(
                    await page.evaluate(() => scrollY),
                    pagePosition,
                    'Backdrop wheel must not scroll the page'
                );
                console.log(`PASS profile=${profile} width=${viewport.width} mode=${mode}`);
            }
            await page.getByRole('button', { name: '关闭', exact: true }).first().click();
            await page.waitForFunction(() => document.body.style.position !== 'fixed');
            assert.equal(
                await page.evaluate(() => scrollY),
                await page.evaluate(() => window.initialScrollPosition),
                'Closing must restore the background scroll position'
            );
            await page.close();
        }
    }
} finally {
    await browser?.close();
    await server.close();
}
