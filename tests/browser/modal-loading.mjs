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
const Profile = createLazyModal('ProfileModal');
const isProfilePreview = new URLSearchParams(location.search).has('profile-preview');
createApp({ setup() {
    const logs = ref(false), preview = ref(false), profile = ref(false);
    window.savedProfiles = [];
    const draft = { id: 'profile', name: 'demo', isPublic: false, subscriptions: [], manualNodes: [] };
    const subscriptions = Array.from({ length: 20 }, (_, index) => ({ id: 'sub-' + index, name: 'Subscription ' + index, url: 'https://example.com/sub-' + index, enabled: true }));
    const previewSource = ref('source');
    window.nextPreviewSource = () => previewSource.value = 'another-source';
    const mounted = useLazyModals({ logs, preview, profile });
    return () => h('main', [
        h('button', { id: 'open-logs', onClick: () => logs.value = true }, 'Open logs'),
        h('button', { id: 'open-preview', onClick: () => preview.value = true }, 'Open preview'),
        h('button', { id: 'open-profile', onClick: () => profile.value = true }, 'Edit profile'),
        mounted.has('logs') && h(Logs, { show: logs.value, 'onUpdate:show': value => logs.value = value }),
        mounted.has('preview') && h(Preview, { show: preview.value, ...(isProfilePreview ? { profileId: previewSource.value, profileName: 'Test source' } : { subscriptionId: previewSource.value, subscriptionName: 'Test source' }), 'onUpdate:show': value => preview.value = value }),
        mounted.has('profile') && h(Profile, { show: profile.value, profile: draft, isNew: false, allSubscriptions: subscriptions, allManualNodes: [], 'onUpdate:show': value => profile.value = value, onSave: value => window.savedProfiles.push(value) }),
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
                    if (request.url?.split('?')[0] !== '/__modal-loading.html') return next();
                    response.setHeader('Content-Type', 'text/html');
                    response.end(
                        `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="${harnessPath}"></script></body></html>`
                    );
                });
            },
        },
    ],
});

async function checkLoadingAlignment(page, testId) {
    const indicator = page.locator(`[data-testid="${testId}"]`);
    await indicator.locator('.loading-orbit').waitFor();
    const geometry = await indicator.evaluate((element) => {
        const body = element.closest('[data-modal-body]');
        const bounds = body.getBoundingClientRect();
        const style = getComputedStyle(body);
        const animation = element.querySelector('.loading-orbit').getBoundingClientRect();
        const message = element.querySelector('p').getBoundingClientRect();
        const left = Math.min(animation.left, message.left);
        const right = Math.max(animation.right, message.right);
        return {
            xOffset: (left + right) / 2 - (bounds.left + bounds.right) / 2,
            yOffset:
                (animation.top + message.bottom) / 2 -
                (bounds.top +
                    parseFloat(style.paddingTop) +
                    bounds.bottom -
                    parseFloat(style.paddingBottom)) /
                    2,
            scrollOverflow: body.scrollHeight - body.clientHeight,
            horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        };
    });
    assert.ok(
        Math.abs(geometry.xOffset) <= 2,
        `${testId} horizontal offset: ${JSON.stringify(geometry)}`
    );
    assert.ok(
        Math.abs(geometry.yOffset) <= 2,
        `${testId} vertical offset: ${JSON.stringify(geometry)}`
    );
    assert.ok(
        geometry.scrollOverflow <= 1,
        `Loading must not add a body scrollbar: ${JSON.stringify(geometry)}`
    );
    assert.ok(geometry.horizontalOverflow <= 0, 'Loading must fit the viewport');
    if (process.env.MODAL_LOADING_SCREENSHOT) {
        const screenshot = page.locator('[role="dialog"] > div');
        await screenshot.screenshot({
            path: `${process.env.MODAL_LOADING_SCREENSHOT}-${testId}-${page.viewportSize().width}-light.png`,
        });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await screenshot.screenshot({
            path: `${process.env.MODAL_LOADING_SCREENSHOT}-${testId}-${page.viewportSize().width}-dark.png`,
        });
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
    }
}

let browser;
try {
    await server.listen();
    browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(chromium.executablePath())
            ? {}
            : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
    });
    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 375, height: 667 },
        { width: 320, height: 650 },
    ]) {
        const { width } = viewport;
        const page = await browser.newPage({ viewport });
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
        let releaseInitialPreviewData;
        const initialPreviewDataGate = new Promise(
            (resolve) => (releaseInitialPreviewData = resolve)
        );
        await page.route('**/api/subscription_nodes', async (route) => {
            previewRequests++;
            if (previewRequests === 1) await initialPreviewDataGate;
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
        await page.goto(
            `${server.resolvedUrls.local[0]}__modal-loading.html${width <= 375 ? '?profile-preview' : ''}`
        );
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
        await checkLoadingAlignment(page, 'log-data-loading');
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
        await checkLoadingAlignment(page, 'modal-code-loading');
        await page.waitForFunction(
            () =>
                !document
                    .querySelector('[role="dialog"] > div')
                    .classList.contains('modal-inner-enter-active')
        );
        const loadingBounds = await page.locator('[role="dialog"] > div').boundingBox();
        await page.waitForFunction(
            () => document.querySelector('.loading-ring').getAnimations()[0]?.currentTime >= 100
        );
        await page.evaluate(() => {
            const ring = document.querySelector('.loading-ring');
            const animation = ring.getAnimations()[0];
            window.previewAnimation = {
                ring,
                animation,
                startTime: animation.startTime,
                time: animation.currentTime,
                frames: 0,
                failures: [],
                active: true,
            };
            const checkFrame = () => {
                const state = window.previewAnimation;
                if (!state.active) return;
                state.frames++;
                if (document.querySelector('.loading-ring') !== state.ring)
                    state.failures.push('ring replaced or hidden');
                if (state.ring.getAnimations()[0] !== state.animation)
                    state.failures.push('CSS animation restarted');
                requestAnimationFrame(checkFrame);
            };
            requestAnimationFrame(checkFrame);
        });
        assert.equal(previewRequests, 1, 'Preview data must load before the preview code is ready');
        let releasePreviewData;
        const previewDataGate = new Promise((resolve) => (releasePreviewData = resolve));
        await page.route('**/api/subscription_nodes', async (route) => {
            await previewDataGate;
            await route.fallback();
        });
        releasePreviewCode();
        await page.locator('[data-testid="node-data-loading"]').waitFor();
        assert.equal(
            await page.locator('[data-testid="node-data-loading"] .loading-orbit').isVisible(),
            true,
            'The indicator must stay visible when code hands off to data loading'
        );
        const dataBounds = await page.locator('[role="dialog"] > div').boundingBox();
        await page.waitForFunction(
            () =>
                window.previewAnimation.animation.currentTime >= window.previewAnimation.time + 100
        );
        const animationContinuity = await page.evaluate(() => {
            const state = window.previewAnimation;
            state.active = false;
            return {
                frames: state.frames,
                failures: state.failures,
                sameRing:
                    document.querySelector('[data-testid="node-data-loading"] .loading-ring') ===
                    state.ring,
                sameAnimation: state.ring.getAnimations()[0] === state.animation,
                sameStart: state.animation.startTime === state.startTime,
                advanced: state.animation.currentTime > state.time,
            };
        });
        assert.ok(animationContinuity.frames > 0);
        assert.deepEqual(
            animationContinuity.failures,
            [],
            'No frame may hide or replace the loading animation'
        );
        assert.ok(
            animationContinuity.sameRing &&
                animationContinuity.sameAnimation &&
                animationContinuity.sameStart &&
                animationContinuity.advanced,
            `The CSS animation must keep its original timeline: ${JSON.stringify(animationContinuity)}`
        );
        for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(
                Math.abs(dataBounds[key] - loadingBounds[key]) <= 1,
                `Preview geometry must stay stable during loading: ${key}; before=${JSON.stringify(loadingBounds)} after=${JSON.stringify(dataBounds)}`
            );
        }
        releaseInitialPreviewData();
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
        // Switching source clears the retained result and exercises the blocking data UI.
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.evaluate(() => window.nextPreviewSource());
        await page.locator('#open-preview').click();
        await checkLoadingAlignment(page, 'node-data-loading');
        releasePreviewData();
        await page.getByText('Demo node', { exact: true }).first().waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'open-preview');

        // Small screens must keep the profile's default action buttons inside its
        // panel while the long form scrolls independently above the fixed footer.
        await page.locator('#open-profile').click();
        await page.locator('#profile-name').waitFor();
        await page.locator('#profile-name').fill('Unsaved');
        const footer = page.locator('[data-modal-footer]');
        const checkFooter = async () => {
            const bounds = await footer.evaluate((element) => {
                const panel = element.closest('[tabindex="-1"]').getBoundingClientRect();
                const footer = element.getBoundingClientRect();
                return {
                    panelBottom: panel.bottom,
                    footerBottom: footer.bottom,
                    buttons: [...element.querySelectorAll('button')].map((button) => {
                        const rect = button.getBoundingClientRect();
                        return {
                            top: rect.top,
                            bottom: rect.bottom,
                            right: rect.right,
                            left: rect.left,
                        };
                    }),
                    footerTop: footer.top,
                    panelRight: panel.right,
                    panelLeft: panel.left,
                };
            });
            assert.equal(bounds.buttons.length, 2);
            assert.ok(
                bounds.footerBottom <= bounds.panelBottom + 1,
                `Profile footer exceeds panel: ${JSON.stringify(bounds)}`
            );
            for (const button of bounds.buttons) {
                assert.ok(
                    button.top >= bounds.footerTop && button.bottom <= bounds.panelBottom - 12,
                    `Profile button exceeds footer: ${JSON.stringify(bounds)}`
                );
                assert.ok(button.left >= bounds.panelLeft && button.right <= bounds.panelRight);
            }
        };
        await checkFooter();
        await page
            .locator('[data-modal-body]')
            .evaluate((body) => (body.scrollTop = body.scrollHeight));
        await checkFooter();
        if (process.env.MODAL_LOADING_SCREENSHOT) {
            await page.evaluate(() => document.documentElement.classList.add('dark'));
            await page.locator('[role="dialog"] > div').screenshot({
                path: `${process.env.MODAL_LOADING_SCREENSHOT}-profile-footer-${width}.png`,
            });
            await page.evaluate(() => document.documentElement.classList.remove('dark'));
        }
        await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(
            await page.evaluate(() => window.savedProfiles.length),
            0,
            'Cancel must not save the profile'
        );
        await page.locator('#open-profile').click();
        await page.locator('#profile-name').fill('Updated profile');
        await footer.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.savedProfiles.length), 1);
        assert.equal(await page.evaluate(() => window.savedProfiles[0].name), 'Updated profile');
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
