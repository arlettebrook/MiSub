import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from '../../src/i18n/index.js';

const controls = vi.hoisted(() => ({ logic: null }));
vi.mock('../../src/composables/useSettingsLogic.js', () => ({
    useSettingsLogic: () => controls.logic,
}));
vi.mock('vue-router', () => ({
    useRoute: () => ({ path: '/dashboard/settings' }),
}));

import SettingsView from '../../src/views/SettingsView.vue';

describe('settings floating save button', () => {
    let wrapper;
    let observers;
    let animationFrames;
    let frameTime;
    const floatingButton = () => document.querySelector('.settings-floating-save');
    const setBottomVisible = async (visible) => {
        observers.at(-1).callback([{ isIntersecting: visible }]);
        await nextTick();
    };
    const flushViewportFrame = async () => {
        const callbacks = [...animationFrames.values()];
        animationFrames.clear();
        frameTime += 1000 / 60;
        callbacks.forEach((callback) => callback(frameTime));
        await nextTick();
    };
    const settleViewportFrames = async () => {
        for (let frame = 0; animationFrames.size && frame < 60; frame++) {
            await flushViewportFrame();
        }
        expect(animationFrames.size).toBe(0);
    };

    beforeEach(() => {
        observers = [];
        animationFrames = new Map();
        frameTime = 0;
        let frameId = 0;
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({ matches: false }))
        );
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback) => {
                animationFrames.set(++frameId, callback);
                return frameId;
            })
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn((id) => animationFrames.delete(id))
        );
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                constructor(callback, options) {
                    this.callback = callback;
                    this.options = options;
                    this.disconnect = vi.fn();
                    this.observe = vi.fn();
                    observers.push(this);
                }
            }
        );
        controls.logic = {
            settings: ref({}),
            disguiseConfig: ref({}),
            isLoading: ref(false),
            isSaving: ref(false),
            hasUnsavedChanges: ref(false),
            showMigrationModal: ref(false),
            hasWhitespace: ref(false),
            isStorageTypeValid: ref(true),
            loadSettings: vi.fn(async () => {}),
            handleSave: vi.fn(),
            handleMigrationSuccess: vi.fn(),
            handleReset: vi.fn(),
            exportBackup: vi.fn(),
            importBackup: vi.fn(),
        };
    });

    afterEach(() => {
        wrapper?.unmount();
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });

    const mountPage = async () => {
        wrapper = mount(SettingsView, {
            attachTo: document.body,
            global: {
                plugins: [createI18n({ initialLocale: 'zh-CN' })],
                stubs: {
                    SettingsSidebar: true,
                    BasicSettings: true,
                    HomeSettings: true,
                    GlobalSettings: true,
                    ServiceSettings: true,
                    ClientSettings: true,
                    CustomPageSettings: true,
                    WebdavBackupSettings: true,
                    SystemSettings: true,
                    MigrationModal: true,
                },
            },
        });
        await flushPromises();
    };

    it('only floats unsaved changes while the permanent bottom button is out of view', async () => {
        await mountPage();
        const bottom = wrapper.find('.settings-layout-footer button');
        expect(bottom.text()).toBe('保存修改');
        await setBottomVisible(false);
        expect(floatingButton()).toBeNull();

        controls.logic.hasUnsavedChanges.value = true;
        await nextTick();
        expect(floatingButton()?.textContent).toContain('保存修改');
        expect(bottom.exists()).toBe(true);

        await setBottomVisible(true);
        expect(floatingButton()).toBeNull();
        await setBottomVisible(false);
        expect(floatingButton()).not.toBeNull();

        controls.logic.hasUnsavedChanges.value = false;
        await nextTick();
        expect(floatingButton()).toBeNull();
    });

    it('uses the same save handler, validation, and saving state for both buttons', async () => {
        await mountPage();
        await setBottomVisible(false);
        controls.logic.hasUnsavedChanges.value = true;
        await nextTick();
        floatingButton().click();
        await wrapper.find('.settings-layout-footer button').trigger('click');
        expect(controls.logic.handleSave).toHaveBeenCalledTimes(2);

        controls.logic.hasWhitespace.value = true;
        await nextTick();
        expect(floatingButton().disabled).toBe(true);
        expect(wrapper.find('.settings-layout-footer button').element.disabled).toBe(true);

        controls.logic.hasWhitespace.value = false;
        controls.logic.isStorageTypeValid.value = false;
        await nextTick();
        expect(floatingButton().disabled).toBe(true);

        controls.logic.isStorageTypeValid.value = true;
        controls.logic.isSaving.value = true;
        await nextTick();
        expect(floatingButton().disabled).toBe(true);
        expect(floatingButton().textContent).toContain('保存中');
    });

    it('hides the floating action and disables saving while session verification is paused', async () => {
        await mountPage();
        await setBottomVisible(false);
        controls.logic.hasUnsavedChanges.value = true;
        await nextTick();
        expect(floatingButton()).not.toBeNull();

        await wrapper.setProps({ sessionPaused: true });
        expect(floatingButton()).toBeNull();
        const bottom = wrapper.find('.settings-layout-footer button');
        expect(bottom.element.disabled).toBe(true);
        bottom.element.click();
        expect(controls.logic.handleSave).not.toHaveBeenCalled();
        expect(controls.logic.hasUnsavedChanges.value).toBe(true);

        await wrapper.setProps({ sessionPaused: false });
        expect(floatingButton()).not.toBeNull();
        expect(bottom.element.disabled).toBe(false);
    });

    it('accounts for mobile navigation and refreshes observation when the viewport changes', async () => {
        const header = document.createElement('header');
        header.className = 'app-nav-bar';
        header.getBoundingClientRect = () => ({ bottom: 52 });
        const nav = document.createElement('nav');
        nav.className = 'mobile-nav-glass';
        let navHeight = 65;
        nav.getBoundingClientRect = () => ({
            height: navHeight,
            top: window.innerHeight - navHeight,
        });
        document.body.append(header, nav);
        await mountPage();
        expect(observers.at(-1).options.rootMargin).toBe('-52px 0px -65px 0px');
        const oldObserver = observers.at(-1);
        navHeight = 80;
        window.dispatchEvent(new Event('resize'));
        await flushViewportFrame();
        expect(oldObserver.disconnect).toHaveBeenCalled();
        expect(observers.at(-1)).not.toBe(oldObserver);
        const finalObserver = observers.at(-1);
        wrapper.unmount();
        wrapper = null;
        expect(finalObserver.disconnect).toHaveBeenCalled();
    });

    it('follows keyboard viewport panning and excludes actions hidden behind the keyboard', async () => {
        vi.stubGlobal('innerHeight', 800);
        vi.stubGlobal(
            'matchMedia',
            vi.fn((query) => ({ matches: query === '(width < 48rem)' }))
        );
        const viewport = new EventTarget();
        Object.assign(viewport, { offsetTop: 0, height: 800 });
        vi.stubGlobal('visualViewport', viewport);
        const removeListener = vi.spyOn(viewport, 'removeEventListener');
        const header = document.createElement('header');
        header.className = 'app-nav-bar';
        header.getBoundingClientRect = () => ({ bottom: 52, height: 52 });
        const nav = document.createElement('nav');
        nav.className = 'mobile-nav-glass';
        nav.getBoundingClientRect = () => ({ height: 65, top: 735 });
        document.body.append(header, nav);
        await mountPage();
        controls.logic.hasUnsavedChanges.value = true;
        const bottom = wrapper.find('.settings-layout-footer button').element.parentElement;
        bottom.getBoundingClientRect = () => ({ width: 140, height: 44, top: 600, bottom: 644 });
        await setBottomVisible(true);
        expect(floatingButton()).toBeNull();

        // Only the visual viewport changes when the keyboard covers the bottom action.
        Object.assign(viewport, { offsetTop: 160, height: 300 });
        viewport.dispatchEvent(new Event('resize'));
        await flushViewportFrame();
        expect(floatingButton()).not.toBeNull();
        expect(floatingButton().style.getPropertyValue('--settings-header-bottom')).toBe('0px');
        expect(floatingButton().style.getPropertyValue('--settings-viewport-top')).toBe('160px');
        expect(observers.at(-1).options.rootMargin).toBe('-160px 0px -340px 0px');

        viewport.offsetTop = 220;
        viewport.dispatchEvent(new Event('scroll'));
        await flushViewportFrame();
        expect(floatingButton().style.getPropertyValue('--settings-header-bottom')).toBe('0px');
        expect(floatingButton().style.getPropertyValue('--settings-viewport-top')).toBe('220px');
        expect(observers.at(-1).options.rootMargin).toBe('-220px 0px -280px 0px');
        const observerCount = observers.length;
        viewport.dispatchEvent(new Event('scroll'));
        await flushViewportFrame();
        expect(observers).toHaveLength(observerCount);

        Object.assign(viewport, { offsetTop: 0, height: 800 });
        viewport.dispatchEvent(new Event('resize'));
        await flushViewportFrame();
        expect(floatingButton()).toBeNull();
        expect(observers.at(-1).options.rootMargin).toBe('-52px 0px -65px 0px');

        const finalObserver = observers.at(-1);
        wrapper.unmount();
        wrapper = null;
        expect(finalObserver.disconnect).toHaveBeenCalled();
        expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
        viewport.offsetTop = 100;
        viewport.dispatchEvent(new Event('scroll'));
        expect(observers.at(-1)).toBe(finalObserver);
    });

    it('updates its position when document scrolling moves the header', async () => {
        const header = document.createElement('header');
        header.className = 'app-nav-bar';
        let headerBottom = 80;
        header.getBoundingClientRect = () => ({ bottom: headerBottom });
        document.body.append(header);
        await mountPage();
        controls.logic.hasUnsavedChanges.value = true;
        await setBottomVisible(false);
        expect(floatingButton().style.getPropertyValue('--settings-header-bottom')).toBe('80px');

        headerBottom = 52;
        window.dispatchEvent(new Event('scroll'));
        await flushViewportFrame();
        expect(floatingButton().style.getPropertyValue('--settings-header-bottom')).toBe('52px');
    });

    it('reclaims the mobile header space as it disappears and restores only its visible portion', async () => {
        vi.stubGlobal(
            'matchMedia',
            vi.fn((query) => ({ matches: query === '(width < 48rem)' }))
        );
        const viewport = new EventTarget();
        Object.assign(viewport, { offsetTop: 0, height: 300 });
        vi.stubGlobal('visualViewport', viewport);
        const header = document.createElement('header');
        header.className = 'app-nav-bar';
        let headerBottom = 52;
        let headerHeight = 52;
        header.getBoundingClientRect = () => ({ bottom: headerBottom, height: headerHeight });
        document.body.append(header);
        await mountPage();
        controls.logic.hasUnsavedChanges.value = true;
        await setBottomVisible(false);

        for (const [offsetTop, bottom, height, visibleHeaderHeight] of [
            [25, 32, 52, 7],
            [80, -10, 52, 0],
            [120, 0, 0, 0],
            [10, 52, 52, 42],
            [0, 52, 52, 52],
        ]) {
            viewport.offsetTop = offsetTop;
            headerBottom = bottom;
            headerHeight = height;
            window.dispatchEvent(new Event('scroll'));
            viewport.dispatchEvent(new Event('scroll'));
            await settleViewportFrames();
            expect(floatingButton()).not.toBeNull();
            expect(floatingButton().style.getPropertyValue('--settings-header-bottom')).toBe(
                `${visibleHeaderHeight}px`
            );
            expect(floatingButton().style.getPropertyValue('--settings-viewport-top')).toBe(
                `${offsetTop}px`
            );
        }
    });

    it('coalesces viewport events and ignores visibility callbacks from old observers', async () => {
        const viewport = new EventTarget();
        Object.assign(viewport, { offsetTop: 0, height: 300 });
        vi.stubGlobal('visualViewport', viewport);
        await mountPage();
        controls.logic.hasUnsavedChanges.value = true;
        await setBottomVisible(false);
        const oldObserver = observers.at(-1);
        const observerCount = observers.length;

        viewport.offsetTop = 80;
        viewport.dispatchEvent(new Event('scroll'));
        viewport.height = 350;
        viewport.dispatchEvent(new Event('resize'));
        viewport.offsetTop = 100;
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        expect(animationFrames.size).toBe(1);
        expect(observers).toHaveLength(observerCount);
        await flushViewportFrame();
        expect(observers).toHaveLength(observerCount + 1);
        expect(observers.at(-1).options.rootMargin).toBe(
            `-100px 0px -${window.innerHeight - 450}px 0px`
        );

        oldObserver.callback([{ isIntersecting: true }]);
        await nextTick();
        expect(floatingButton()).not.toBeNull();
        await setBottomVisible(true);
        expect(floatingButton()).toBeNull();
    });

    it('cancels a pending viewport update when unmounted', async () => {
        await mountPage();
        window.dispatchEvent(new Event('scroll'));
        expect(animationFrames.size).toBe(1);
        const finalObserver = observers.at(-1);
        wrapper.unmount();
        wrapper = null;
        expect(window.cancelAnimationFrame).toHaveBeenCalled();
        expect(animationFrames.size).toBe(0);
        window.dispatchEvent(new Event('resize'));
        expect(animationFrames.size).toBe(0);
        finalObserver.callback([{ isIntersecting: true }]);
        expect(floatingButton()).toBeNull();
    });
});
