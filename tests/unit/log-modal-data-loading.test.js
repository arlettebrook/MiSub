import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LogModal from '../../src/components/modals/LogModal.vue';
import { createI18n } from '../../src/i18n/index.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), toast: vi.fn() }));
vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    api: { get: mocks.get },
}));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast: mocks.toast }) }));
let wrapper;
beforeEach(() => {
    mocks.get.mockReset();
    mocks.toast.mockClear();
});
afterEach(() => wrapper?.unmount());
function open(show = true) {
    wrapper = mount(LogModal, {
        props: { show },
        global: {
            plugins: [createI18n({ initialLocale: 'en-US' })],
            stubs: {
                Modal: {
                    props: ['show'],
                    template:
                        '<section v-if="show"><slot name="title"/><slot name="body"/></section>',
                },
            },
        },
    });
    return wrapper;
}
const log = (name) => ({
    id: name,
    profileName: name,
    timestamp: 1,
    userAgent: '',
    status: 'success',
});

describe('log dialog request feedback', () => {
    it('keeps previous logs visible while refreshing on reopen', async () => {
        mocks.get.mockResolvedValueOnce({ data: [log('Previous log')] });
        open();
        await flushPromises();
        await wrapper.setProps({ show: false });
        let finish;
        mocks.get.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
        await wrapper.setProps({ show: true });
        expect(wrapper.text()).toContain('Previous log');
        expect(wrapper.get('[role="status"]').text()).toContain('Refreshing logs');
        finish({ data: [log('Updated log')] });
        await flushPromises();
        expect(wrapper.text()).toContain('Updated log');
        expect(wrapper.text()).not.toContain('Previous log');
    });

    it('aborts a closed request and ignores its failure after a new opening', async () => {
        let rejectOld;
        mocks.get.mockImplementationOnce(() => new Promise((_, reject) => (rejectOld = reject)));
        open();
        const signal = mocks.get.mock.calls[0][1].signal;
        await wrapper.setProps({ show: false });
        expect(signal.aborted).toBe(true);
        mocks.get.mockResolvedValueOnce({ data: [log('Current log')] });
        await wrapper.setProps({ show: true });
        await flushPromises();
        rejectOld(new Error('Obsolete failure'));
        await flushPromises();
        expect(wrapper.text()).toContain('Current log');
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(wrapper.vm.isLoading).toBe(false);
    });
});
