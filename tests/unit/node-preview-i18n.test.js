import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import NodePreviewModal from '../../src/components/modals/NodePreview/NodePreviewModal.vue';
import { createI18n } from '../../src/i18n/index.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { api } from '../../src/lib/http.js';

enableAutoUnmount(afterEach);

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    APIError: class APIError extends Error {},
    api: {
        post: vi.fn(async () => ({
            success: true,
            nodes: [
                {
                    id: 'node-1',
                    name: 'Demo HK',
                    url: 'vless://demo@example.com:443#Demo',
                    type: 'vless',
                    server: 'example.com',
                    port: 443,
                    region: 'Hong Kong',
                },
            ],
            stats: {
                protocols: { vless: 1 },
                regions: { 'Hong Kong': 1 },
            },
        })),
    },
}));

vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({
        showToast: toastMock,
    }),
}));

const expectNoChineseOrKeys = (text) => {
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(text).not.toMatch(/\b(nodePreview|common|actions)\./);
};

describe('NodePreviewModal English translations', () => {
    beforeEach(() => {
        toastMock.mockClear();
        api.post.mockClear();
    });

    it('renders profile preview header and picking actions in English', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);

        const wrapper = mount(NodePreviewModal, {
            props: {
                show: true,
                profileId: 'profile-1',
                profileName: 'CMSS',
            },
            global: {
                plugins: [pinia, createI18n({ initialLocale: 'en-US' })],
                stubs: {
                    Teleport: true,
                    NodeFilters: true,
                    NodeList: true,
                    NodeCard: true,
                    NodePagination: true,
                },
            },
        });

        await flushPromises();

        expect(wrapper.text()).toContain('CMSS');
        expect(wrapper.text()).toContain('Profile node overview');
        expect(wrapper.text()).toContain('Pick nodes');
        expect(wrapper.text()).toContain('Nodes Total');
        expect(wrapper.text()).toContain('Protocols');
        expect(wrapper.text()).toContain('Regions');
        expect(wrapper.text()).toContain('Total Pages');
        expectNoChineseOrKeys(wrapper.text());

        await wrapper
            .findAll('button')
            .find((button) => button.text() === 'Pick nodes')
            .trigger('click');

        expect(wrapper.text()).toContain('Exit picking');
        expect(wrapper.text()).toContain('Picking mode');
        expect(wrapper.text()).toContain('Selected');
        expect(wrapper.text()).toContain('Select all');
        expect(wrapper.text()).toContain('Clear');
        expect(wrapper.text()).toContain('Save selection');
        expectNoChineseOrKeys(wrapper.text());
    });

    it('saves selected preview nodes as manual nodes without using a missing store action', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        const dataStore = useDataStore();

        const wrapper = mount(NodePreviewModal, {
            props: {
                show: true,
                profileId: 'profile-1',
                profileName: 'CMSS',
            },
            global: {
                plugins: [pinia, createI18n({ initialLocale: 'en-US' })],
                stubs: {
                    Teleport: true,
                    NodeFilters: true,
                    NodeList: true,
                    NodeCard: true,
                    NodePagination: true,
                },
            },
        });

        await flushPromises();

        const findButton = (label) =>
            wrapper.findAll('button').find((button) => button.text().includes(label));
        await findButton('Pick nodes').trigger('click');
        await findButton('Select all').trigger('click');
        await findButton('Save selection').trigger('click');
        await flushPromises();

        expect(dataStore.subscriptions).toHaveLength(1);
        expect(dataStore.subscriptions[0]).toMatchObject({
            name: 'Demo HK',
            url: 'vless://demo@example.com:443#Demo',
            enabled: true,
        });
        expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('1'), 'success');
        expect(wrapper.text()).not.toContain('Picking mode');
    });
});

describe('NodePreviewModal refresh', () => {
    const mountPreview = (props = {}) => {
        const pinia = createPinia();
        setActivePinia(pinia);
        return mount(NodePreviewModal, {
            props: { show: true, subscriptionId: 'source-1', ...props },
            global: {
                plugins: [pinia, createI18n({ initialLocale: 'en-US' })],
                stubs: {
                    Teleport: true,
                    NodeFilters: true,
                    NodeCard: true,
                    NodePagination: true,
                },
            },
        });
    };

    beforeEach(() => api.post.mockClear());

    it('keeps the last nodes visible while reopening the same source and cancels a pending request on close', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
        const wrapper = mountPreview();
        await flushPromises();
        await wrapper.setProps({ show: false });
        clock.mockReturnValue(31_001);
        let finish;
        api.post.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.setProps({ show: true });
        expect(wrapper.text()).toContain('Demo HK');
        expect(wrapper.text()).toContain('Refreshing');
        const signal = api.post.mock.calls.at(-1)[2].signal;
        await wrapper.setProps({ show: false });
        expect(signal.aborted).toBe(true);
        finish({ success: true, nodes: [{ name: 'Obsolete', url: 'ss://obsolete' }] });
        await flushPromises();
        expect(wrapper.vm.allNodes[0].name).toBe('Demo HK');
        clock.mockRestore();
    });

    it('clears the previous source immediately when switching to another source', async () => {
        const wrapper = mountPreview();
        await flushPromises();
        let finish;
        api.post.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.setProps({ subscriptionId: 'source-2' });
        expect(wrapper.text()).not.toContain('Demo HK');
        expect(api.post.mock.calls.at(-1)[1].subscriptionId).toBe('source-2');
        finish({ success: true, nodes: [{ name: 'Source 2', url: 'ss://source2' }] });
        await flushPromises();
        expect(wrapper.vm.allNodes[0].name).toBe('Source 2');
    });

    it.each([
        { subscriptionId: 'source-1' },
        { subscriptionId: undefined, profileId: 'profile-1' },
        { subscriptionId: undefined, subscriptionUrl: 'https://example.com/sub' },
    ])('forces a new request and displays returned nodes: %j', async (props) => {
        const wrapper = mountPreview(props);
        await flushPromises();
        const initialRequest = api.post.mock.calls[0][1];
        expect(initialRequest.forceRefresh).toBeUndefined();

        let complete;
        api.post.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
        const button = wrapper.find('button[aria-label="Fetch nodes again"]');
        await button.trigger('click');

        expect(api.post.mock.calls.at(-1)[1]).toEqual({ ...initialRequest, forceRefresh: true });
        expect(button.attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('Refreshing');
        expect(wrapper.text()).toContain('Demo HK');
        await button.trigger('click');
        expect(api.post).toHaveBeenCalledTimes(2);

        complete({
            success: true,
            nodes: [
                {
                    name: 'Updated Node',
                    protocol: 'trojan',
                    region: '其他',
                    url: 'trojan://test@example.com:443#Updated',
                },
            ],
            stats: { protocols: { trojan: 1 }, regions: { 其他: 1 } },
        });
        await flushPromises();

        expect(wrapper.text()).toContain('Updated Node');
        expect(wrapper.text()).not.toContain('Demo HK');
        expect(button.attributes('disabled')).toBeUndefined();
    });

    it('keeps current nodes and shows a failure message when refresh fails', async () => {
        const wrapper = mountPreview();
        await flushPromises();
        api.post.mockResolvedValueOnce({ success: false, error: 'HTTP 403' });
        await wrapper.find('button[aria-label="Fetch nodes again"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toContain('Previous nodes kept: HTTP 403');
        expect(wrapper.text()).toContain('Demo HK');
    });

    it('allows a failed initial load to be retried with a fresh fetch', async () => {
        api.post.mockResolvedValueOnce({ success: false, error: 'HTTP 403' });
        const wrapper = mountPreview();
        await flushPromises();
        expect(wrapper.text()).toContain('HTTP 403');
        await wrapper.find('button[aria-label="Fetch nodes again"]').trigger('click');
        await flushPromises();

        expect(api.post.mock.calls.at(-1)[1].forceRefresh).toBe(true);
        expect(wrapper.text()).toContain('Demo HK');
        expect(wrapper.text()).not.toContain('HTTP 403');
    });

    it('ignores an old refresh response after the preview is closed and reopened', async () => {
        const wrapper = mountPreview();
        await flushPromises();
        let completeOldRefresh;
        api.post.mockImplementationOnce(
            () => new Promise((resolve) => (completeOldRefresh = resolve))
        );
        await wrapper.find('button[aria-label="Fetch nodes again"]').trigger('click');
        await wrapper.setProps({ show: false });
        await wrapper.setProps({ show: true });
        await flushPromises();
        completeOldRefresh({
            success: true,
            nodes: [{ name: 'Outdated Node', url: 'trojan://test@example.com:443#Outdated' }],
        });
        await flushPromises();

        expect(wrapper.text()).toContain('Demo HK');
        expect(wrapper.text()).not.toContain('Outdated Node');
        expect(
            wrapper.find('button[aria-label="Fetch nodes again"]').attributes('disabled')
        ).toBeUndefined();
    });
});
