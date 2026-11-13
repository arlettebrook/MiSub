import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    defineAsyncComponent,
    defineComponent,
    h,
    nextTick,
    onMounted,
    onUnmounted,
    ref,
} from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createI18n } from '../../src/i18n/index.js';
import { useLazyModals } from '../../src/composables/useLazyModals.js';
import LogModal from '../../src/components/modals/LogModal.vue';
import SubscriptionEditModal from '../../src/components/modals/SubscriptionEditModal.vue';
import GroupManagementModal from '../../src/components/modals/GroupManagementModal.vue';
import GuestbookModal from '../../src/components/modals/GuestbookModal.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), showToast: vi.fn() }));
vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    api: { get: mocks.get },
}));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: mocks.showToast }),
}));

const wrappers = [];
const options = {
    plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
    stubs: {
        Modal: {
            props: ['show'],
            template:
                '<div v-if="show"><slot name="title" /><slot name="body" /><slot name="footer" /></div>',
        },
        draggable: true,
    },
};

afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.clearAllMocks();
});

describe('modal loading on first use', () => {
    it('defers the async loader and keeps the instance through closing and reopening', async () => {
        const visible = ref(false);
        const mounted = vi.fn();
        const unmounted = vi.fn();
        const Dialog = defineComponent({
            props: { show: Boolean },
            setup() {
                onMounted(mounted);
                onUnmounted(unmounted);
                return () => h('div');
            },
        });
        const loader = vi.fn(async () => Dialog);
        const AsyncDialog = defineAsyncComponent(loader);
        const Host = defineComponent({
            setup() {
                const requested = useLazyModals({ dialog: visible });
                return () =>
                    requested.has('dialog') ? h(AsyncDialog, { show: visible.value }) : null;
            },
        });
        const wrapper = mount(Host);
        wrappers.push(wrapper);
        await flushPromises();
        expect(loader).not.toHaveBeenCalled();
        visible.value = true;
        await flushPromises();
        expect(loader).toHaveBeenCalledOnce();
        expect(mounted).toHaveBeenCalledOnce();
        visible.value = false;
        await nextTick();
        expect(wrapper.findComponent(Dialog).props('show')).toBe(false);
        expect(unmounted).not.toHaveBeenCalled();
        visible.value = true;
        await flushPromises();
        expect(loader).toHaveBeenCalledOnce();
        expect(mounted).toHaveBeenCalledOnce();
    });

    it('fetches logs on the initial lazy mount and refreshes once on each reopening', async () => {
        mocks.get.mockResolvedValue({ data: [] });
        const visible = ref(false);
        const AsyncLogs = defineAsyncComponent(async () => LogModal);
        const Host = defineComponent({
            setup() {
                const requested = useLazyModals({ logs: visible });
                return () => (requested.has('logs') ? h(AsyncLogs, { show: visible.value }) : null);
            },
        });
        const wrapper = mount(Host, { global: options });
        wrappers.push(wrapper);
        await flushPromises();
        expect(mocks.get).not.toHaveBeenCalled();
        visible.value = true;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledOnce();
        expect(mocks.get.mock.calls[0][0]).toMatch(/^\/api\/logs\?t=/);
        visible.value = false;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledOnce();
        visible.value = true;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledTimes(2);
    });

    it('does not fetch logs if the first opening is cancelled before the code finishes loading', async () => {
        mocks.get.mockResolvedValue({ data: [] });
        const visible = ref(false);
        let finishLoading;
        const AsyncLogs = defineAsyncComponent(
            () => new Promise((resolve) => (finishLoading = resolve))
        );
        const Host = defineComponent({
            setup() {
                const requested = useLazyModals({ logs: visible });
                return () => (requested.has('logs') ? h(AsyncLogs, { show: visible.value }) : null);
            },
        });
        const wrapper = mount(Host, { global: options });
        wrappers.push(wrapper);
        visible.value = true;
        await nextTick();
        visible.value = false;
        await nextTick();
        finishLoading(LogModal);
        await flushPromises();
        expect(mocks.get).not.toHaveBeenCalled();
        visible.value = true;
        await flushPromises();
        expect(mocks.get).toHaveBeenCalledOnce();
    });

    it.each(['proto:vless', 'keep:proto:vless', '  proto:vless\n---\nkeep:香港  '])(
        'initializes existing subscription rules without rewriting %s',
        async (exclude) => {
            const subscription = { name: 'Existing', url: 'https://example.com/sub', exclude };
            const wrapper = mount(SubscriptionEditModal, {
                props: { show: true, isNew: false, editingSubscription: subscription },
                global: options,
            });
            wrappers.push(wrapper);
            await flushPromises();
            expect(subscription.exclude).toBe(exclude);
            expect(wrapper.vm.ruleMode).toBe(exclude.includes('keep:') ? 'keep' : 'exclude');
            if (exclude.includes('---')) expect(wrapper.vm.isAdvancedMode).toBe(true);
            else expect(wrapper.vm.selectedRules[0].pattern).toBe('proto:vless');
        }
    );

    it('writes rules when the user changes the visual mode', async () => {
        const subscription = {
            name: 'Existing',
            url: 'https://example.com/sub',
            exclude: 'keep:proto:vless',
        };
        const wrapper = mount(SubscriptionEditModal, {
            props: { show: true, isNew: false, editingSubscription: subscription },
            global: options,
        });
        wrappers.push(wrapper);
        wrapper.findComponent({ name: 'RuleSection' }).vm.$emit('update:ruleMode', 'exclude');
        await nextTick();
        expect(subscription.exclude).toBe('proto:vless');
    });

    it('shows groups on the initial lazy mount and refreshes them when reopened', async () => {
        const wrapper = mount(GroupManagementModal, {
            props: { show: true, groups: ['Hong Kong', 'Japan'] },
            global: options,
        });
        wrappers.push(wrapper);
        expect(wrapper.vm.localGroups.map((group) => group.name)).toEqual(['Hong Kong', 'Japan']);
        await wrapper.setProps({ show: false, groups: ['Germany'] });
        await wrapper.setProps({ show: true });
        expect(wrapper.vm.localGroups.map((group) => group.name)).toEqual(['Germany']);
    });

    it('generates the guestbook captcha when first mounted open', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
        try {
            const wrapper = mount(GuestbookModal, {
                props: { show: true, config: { enabled: true } },
                global: options,
            });
            wrappers.push(wrapper);
            expect(wrapper.vm.captcha.num1).toBeGreaterThan(0);
            expect(wrapper.vm.captcha.num2).toBeGreaterThan(0);
            expect(wrapper.vm.captcha.answer).toBeGreaterThan(0);
        } finally {
            random.mockRestore();
        }
    });
});
