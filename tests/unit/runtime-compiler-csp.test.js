import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomeView from '../../src/views/HomeView.vue';
import { useSessionStore } from '../../src/stores/session.js';

// Reproduce the runtime compiler registered by the vuedraggable UMD build.
vi.mock('vue', async () => vi.importActual('vue/dist/vue.esm-bundler.js'));

afterEach(() => vi.unstubAllGlobals());

describe('home navigation under strict CSP', () => {
    it('renders the authenticated redirect placeholder without dynamic compilation', async () => {
        const pinia = createPinia();
        useSessionStore(pinia).sessionState = 'loggedIn';
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { render: () => null } },
                { path: '/dashboard', component: { render: () => null } },
            ],
        });
        await router.push('/');

        const blockedCompile = vi.fn(() => {
            throw new EvalError('call to Function() blocked by CSP');
        });
        vi.stubGlobal(
            'Function',
            new Proxy(Function, {
                construct(target, args) {
                    if (args[0] === 'Vue') return blockedCompile();
                    return Reflect.construct(target, args, target);
                },
                apply(target, thisArg, args) {
                    if (args[0] === 'Vue') return blockedCompile();
                    return Reflect.apply(target, thisArg, args);
                },
            })
        );

        const onError = vi.fn();
        const wrapper = mount(HomeView, {
            global: { plugins: [pinia, router], config: { errorHandler: onError } },
        });
        try {
            await flushPromises();
            expect(blockedCompile).not.toHaveBeenCalled();
            expect(onError).not.toHaveBeenCalled();
            expect(wrapper.html()).toBe('<div></div>');
            expect(router.currentRoute.value.path).toBe('/dashboard');
        } finally {
            wrapper.unmount();
        }
    });
});
