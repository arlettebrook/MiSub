import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../../src/components/layout/Footer.vue';

let wrapper;
let router;
let metrics;
let clock;
const restoreMetrics = [];

const metric = (object, key, get) => {
    const original = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, get });
    restoreMetrics.push(() => {
        if (original) Object.defineProperty(object, key, original);
        else delete object[key];
    });
};

const scroll = (y) => {
    metrics.y = y;
    window.dispatchEvent(new Event('scroll'));
};
const touch = (type, y, x = 100, target = window) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
    });
    target.dispatchEvent(event);
};
const swipe = async () => {
    touch('touchstart', 500);
    touch('touchmove', 430);
    touch('touchend', 430);
    await flushPromises();
};
const wheel = (deltaY = 100) => window.dispatchEvent(new WheelEvent('wheel', { deltaY }));

beforeEach(async () => {
    metrics = { y: 0, height: 1200, viewport: 600 };
    clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    metric(window, 'scrollY', () => metrics.y);
    metric(window, 'innerHeight', () => metrics.viewport);
    metric(
        document.documentElement,
        'scrollHeight',
        () =>
            metrics.height +
            (wrapper && wrapper.get('footer').element.style.display !== 'none' ? 80 : 0)
    );
    vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => {
        scroll(
            Math.max(0, Math.min(top, document.documentElement.scrollHeight - metrics.viewport))
        );
    });
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/other', component: { template: '<div />' } },
        ],
    });
    await router.push('/');
    wrapper = mount(Footer, {
        attachTo: document.body,
        global: { plugins: [createPinia(), router] },
    });
    vi.spyOn(wrapper.get('footer').element, 'getBoundingClientRect').mockImplementation(() => ({
        top: metrics.height - metrics.y,
        height: 80,
    }));
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    restoreMetrics
        .splice(0)
        .reverse()
        .forEach((restore) => restore());
    document.body.style.overflow = '';
    vi.restoreAllMocks();
});

describe('footer reveal gestures', () => {
    it('does not occupy visible space until a second swipe starts at the bottom', async () => {
        expect(wrapper.get('footer').isVisible()).toBe(false);
        touch('touchstart', 500);
        scroll(600);
        touch('touchmove', 430);
        touch('touchend', 430);
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(false);

        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(true);
        expect(wrapper.emitted('visible-height').at(-1)).toEqual([80]);
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 1280, behavior: 'smooth' });
    });

    it('ignores wheel inertia from reaching the bottom and reveals on the next wheel gesture', async () => {
        wheel();
        scroll(600);
        clock += 50;
        wheel();
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(false);
        clock += 300;
        wheel();
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(true);
    });

    it('requires two gestures on a page that already fits in the viewport', async () => {
        metrics.height = 600;
        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(false);
        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(true);
    });

    it('supports a second End key press and ignores a held key', async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
        scroll(600);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', repeat: true }));
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(false);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(true);
        expect(document.activeElement).toBe(wrapper.get('footer').element);
    });

    it('collapses only after leaving the viewport and preserves the scroll position', async () => {
        scroll(600);
        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(true);
        window.scrollTo.mockClear();
        scroll(400);
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(false);
        expect(metrics.y).toBe(400);
        expect(wrapper.emitted('visible-height').at(-1)).toEqual([0]);
        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('does not reveal behind a modal and resets after route navigation', async () => {
        scroll(600);
        document.body.style.overflow = 'hidden';
        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(false);
        document.body.style.overflow = '';
        await swipe();
        expect(wrapper.get('footer').isVisible()).toBe(true);
        await router.push('/other');
        await flushPromises();
        expect(wrapper.get('footer').isVisible()).toBe(false);
    });

    it('removes gesture listeners and prevents a late reveal from scrolling after unmount', async () => {
        scroll(600);
        const remove = vi.spyOn(window, 'removeEventListener');
        touch('touchstart', 500);
        touch('touchmove', 430);
        touch('touchend', 430);
        wrapper.unmount();
        wrapper = null;
        await flushPromises();
        expect(window.scrollTo).not.toHaveBeenCalled();
        for (const name of [
            'scroll',
            'wheel',
            'touchstart',
            'touchmove',
            'touchend',
            'touchcancel',
            'keydown',
            'pagehide',
        ]) {
            expect(remove).toHaveBeenCalledWith(name, expect.any(Function));
        }
    });
});
