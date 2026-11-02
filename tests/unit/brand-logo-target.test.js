import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { defineComponent, h, onMounted, onUnmounted } from 'vue';
import BrandLogo from '../../src/components/layout/BrandLogo.vue';
import Header from '../../src/components/layout/Header.vue';
import NavBar from '../../src/components/layout/NavBar.vue';
import HomeView from '../../src/views/HomeView.vue';
import { useSessionStore } from '../../src/stores/session.js';
import { createI18n } from '../../src/i18n/index.js';

const wrappers = [];
const navigationComponents = [
    { name: 'Header', component: Header },
    { name: 'NavBar', component: NavBar },
];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function mountNavigation(
    component,
    {
        props = {},
        path = '/dashboard/nodes',
        dashboard = { render: () => h('div') },
        withView = false,
    } = {}
) {
    const pinia = createPinia();
    useSessionStore(pinia).sessionState = props.isLoggedIn ? 'loggedIn' : 'loggedOut';
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: HomeView },
            { path: '/dashboard', component: dashboard },
            { path: '/dashboard/nodes', component: { render: () => h('div') } },
            { path: '/dashboard/groups', component: { render: () => h('div') } },
            { path: '/dashboard/subscriptions', component: { render: () => h('div') } },
            { path: '/dashboard/settings', component: { render: () => h('div') } },
        ],
    });
    await router.push(path);
    await router.isReady();

    const root = withView
        ? defineComponent({ render: () => h('div', [h(component, props), h(RouterView)]) })
        : component;
    const wrapper = mount(root, {
        ...(withView ? {} : { props }),
        global: {
            plugins: [pinia, router, createI18n({ initialLocale: 'zh-CN' })],
            stubs: { NavActionGroup: { render: () => null } },
        },
    });
    wrappers.push(wrapper);
    await flushPromises();
    return { wrapper, router };
}

describe('brand logo navigation targets', () => {
    it('defaults to the public homepage', async () => {
        const { wrapper } = await mountNavigation(BrandLogo);
        expect(wrapper.get('.nav-brand-wrap').attributes('href')).toBe('/');
    });

    it('accepts a custom navigation target', async () => {
        const { wrapper } = await mountNavigation(BrandLogo, { props: { to: '/dashboard' } });
        expect(wrapper.get('.nav-brand-wrap').attributes('href')).toBe('/dashboard');
    });

    it.each([
        { isLoggedIn: true, hideBranding: false, target: '/dashboard' },
        { isLoggedIn: false, hideBranding: false, target: '/' },
        { isLoggedIn: true, hideBranding: true, target: '/dashboard' },
        { isLoggedIn: false, hideBranding: true, target: '/' },
    ])(
        'uses $target in Header with login=$isLoggedIn and hidden branding=$hideBranding',
        async ({ isLoggedIn, hideBranding, target }) => {
            const { wrapper } = await mountNavigation(Header, {
                props: { isLoggedIn, hideBranding },
            });
            expect(wrapper.get('header a').attributes('href')).toBe(target);
            expect(wrapper.find('.nav-brand-wrap').exists()).toBe(!hideBranding);
        }
    );

    it.each([true, false])(
        'uses the appropriate target for both NavBar logos with login=%s',
        async (isLoggedIn) => {
            const { wrapper } = await mountNavigation(NavBar, { props: { isLoggedIn } });
            const logos = wrapper.findAll('.nav-brand-wrap');
            expect(logos).toHaveLength(2);
            for (const logo of logos) {
                expect(logo.attributes('href')).toBe(isLoggedIn ? '/dashboard' : '/');
            }
        }
    );

    it.each(navigationComponents)(
        'keeps the active dashboard mounted when clicking the $name logo',
        async ({ component }) => {
            const mounted = vi.fn();
            const unmounted = vi.fn();
            const dashboard = defineComponent({
                setup() {
                    onMounted(mounted);
                    onUnmounted(unmounted);
                    return () => h('div');
                },
            });
            const { wrapper, router } = await mountNavigation(component, {
                props: { isLoggedIn: true },
                path: '/dashboard',
                dashboard,
                withView: true,
            });
            const visited = [];
            router.beforeEach((to) => {
                visited.push(to.path);
            });

            // NavBar 同时渲染移动端和桌面端 LOGO，两者均应保持组件实例。
            for (const logo of wrapper.findAll('.nav-brand-wrap')) {
                await logo.trigger('click');
                await flushPromises();
                expect(router.currentRoute.value.path).toBe('/dashboard');
                expect(mounted).toHaveBeenCalledTimes(1);
                expect(unmounted).not.toHaveBeenCalled();
            }
            expect(visited).not.toContain('/');
        }
    );

    it.each(navigationComponents)(
        'navigates directly from a subpage when clicking the $name logo',
        async ({ component }) => {
            const { wrapper, router } = await mountNavigation(component, {
                props: { isLoggedIn: true },
                withView: true,
            });
            const visited = [];
            router.beforeEach((to) => {
                visited.push(to.path);
            });
            await wrapper.get('.nav-brand-wrap').trigger('click');
            await flushPromises();

            expect(router.currentRoute.value.path).toBe('/dashboard');
            expect(visited).toEqual(['/dashboard']);
        }
    );
});
