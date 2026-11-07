import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import QRCodeModal from '../../src/components/modals/QRCodeModal.vue';
import PublicProfilesView from '../../src/views/PublicProfilesView.vue';
import { createI18n } from '../../src/i18n/index.js';

const mocks = vi.hoisted(() => ({ toCanvas: vi.fn(), showToast: vi.fn(), get: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toCanvas: mocks.toCanvas } }));
vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({ showToast: mocks.showToast }),
}));
vi.mock('../../src/lib/http.js', () => ({ api: { get: mocks.get } }));

let wrapper;
const options = (locale) => ({
  plugins: [createI18n({ initialLocale: locale })],
  stubs: {
    Teleport: true,
    Modal: {
      props: ['show'],
      template: '<section v-if="show"><slot name="title" /><slot name="body" /></section>',
    },
    ProfileGrid: true,
    NodePreviewModal: true,
    AnnouncementCard: true,
    GuestbookModal: true,
    QuickImportModal: true,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toCanvas.mockReset();
  mocks.toCanvas.mockResolvedValue(undefined);
  mocks.get.mockImplementation(async (url) =>
    url === '/api/public/profiles'
      ? {
          success: true,
          data: [{ id: 'one', name: 'Demo' }],
          config: { profileToken: 'sample-token' },
        }
      : { success: true, data: [] }
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await vi.dynamicImportSettled();
  wrapper?.unmount();
  vi.restoreAllMocks();
});

describe('QR modal generation feedback', () => {
  it.each([
    ['zh-CN', '二维码'],
    ['en-US', 'QR Code'],
  ])('uses a translated default title in %s', async (locale, title) => {
    wrapper = mount(QRCodeModal, {
      props: { show: true, url: 'https://example.com/sub' },
      global: options(locale),
    });
    await flushPromises();
    expect(wrapper.get('h3').text()).toBe(title);
  });

  it('keeps a supplied title and enables download after successful generation', async () => {
    wrapper = mount(QRCodeModal, {
      props: { show: true, url: 'https://example.com/sub', title: 'Demo' },
      global: options('en-US'),
    });
    await flushPromises();
    expect(wrapper.get('h3').text()).toBe('Demo');
    expect(wrapper.get('[data-testid="qr-download"]').element.disabled).toBe(false);
  });

  it.each(['zh-CN', 'en-US'])(
    'reports failure, blocks empty downloads and retries in %s',
    async (locale) => {
      mocks.toCanvas.mockRejectedValueOnce(new Error('Too much data'));
      const i18n = createI18n({ initialLocale: locale });
      wrapper = mount(QRCodeModal, {
        props: { show: true, url: 'https://example.com/sub' },
        global: options(locale),
      });
      await flushPromises();
      expect(mocks.showToast).toHaveBeenCalledWith(i18n.t('qr.generateFailed'), 'error');
      expect(wrapper.get('[role="alert"]').text()).toBe(i18n.t('qr.generateFailed'));
      expect(wrapper.get('[data-testid="qr-download"]').element.disabled).toBe(true);
      await wrapper.get('[data-testid="qr-retry"]').trigger('click');
      await flushPromises();
      expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.get('[data-testid="qr-download"]').element.disabled).toBe(false);
    }
  );

  it('does not announce an obsolete generation failure after the URL changes', async () => {
    let rejectFirst;
    mocks.toCanvas.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );
    wrapper = mount(QRCodeModal, {
      props: { show: true, url: 'https://example.com/old' },
      global: options('en-US'),
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="qr-download"]').element.disabled).toBe(true);
    await wrapper.setProps({ url: 'https://example.com/new' });
    await flushPromises();
    rejectFirst(new Error('Obsolete failure'));
    await flushPromises();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="qr-download"]').element.disabled).toBe(false);
  });

  it('does not announce a pending QR failure after the modal closes', async () => {
    let rejectGeneration;
    mocks.toCanvas.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectGeneration = reject;
        })
    );
    wrapper = mount(QRCodeModal, {
      props: { show: true, url: 'https://example.com/sub' },
      global: options('en-US'),
    });
    await flushPromises();
    await wrapper.setProps({ show: false });
    rejectGeneration(new Error('Closed modal'));
    await flushPromises();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

describe('public QR generation feedback', () => {
  it('ignores a failure from an older request after reopening the same public QR', async () => {
    let rejectFirst;
    mocks.toCanvas.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        })
    );
    wrapper = mount(PublicProfilesView, { global: options('en-US') });
    await flushPromises();
    const grid = wrapper.findComponent({ name: 'ProfileGrid' });
    const profile = { id: 'one', name: 'Demo' };
    grid.vm.$emit('register-canvas', 'one', document.createElement('canvas'));
    grid.vm.$emit('toggle-qr', profile);
    await flushPromises();
    grid.vm.$emit('toggle-qr', profile);
    grid.vm.$emit('toggle-qr', profile);
    await flushPromises();
    rejectFirst(new Error('Obsolete failure'));
    await flushPromises();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(grid.props('isQrExpanded')('one')).toBe(true);
  });

  it.each(['zh-CN', 'en-US'])(
    'reports a failed QR and allows reopening it in %s',
    async (locale) => {
      mocks.toCanvas.mockRejectedValueOnce(new Error('Too much data'));
      const i18n = createI18n({ initialLocale: locale });
      wrapper = mount(PublicProfilesView, { global: options(locale) });
      await flushPromises();
      const grid = wrapper.findComponent({ name: 'ProfileGrid' });
      const profile = { id: 'one', name: 'Demo' };
      const canvas = document.createElement('canvas');
      grid.vm.$emit('register-canvas', 'one', canvas);
      grid.vm.$emit('toggle-qr', profile);
      await flushPromises();
      expect(mocks.showToast).toHaveBeenCalledWith(
        i18n.t('publicProfiles.qrGenerateFailed'),
        'error'
      );
      expect(grid.props('isQrExpanded')('one')).toBe(false);
      const dataURL = vi.spyOn(canvas, 'toDataURL');
      grid.vm.$emit('download-qr', profile);
      expect(dataURL).not.toHaveBeenCalled();
      grid.vm.$emit('toggle-qr', profile);
      await flushPromises();
      expect(mocks.toCanvas).toHaveBeenCalledTimes(2);
      expect(grid.props('isQrExpanded')('one')).toBe(true);
    }
  );

  it('keeps auxiliary client-list failures quiet', async () => {
    mocks.get.mockImplementation(async (url) => {
      if (url === '/api/clients') throw new Error('Client list unavailable');
      return { success: true, data: [{ id: 'one', name: 'Demo' }] };
    });
    wrapper = mount(PublicProfilesView, { global: options('en-US') });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'ProfileGrid' }).exists()).toBe(true);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
