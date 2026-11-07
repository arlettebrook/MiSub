import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useSubscriptions } from '../../src/composables/useSubscriptions.js';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';
import { setLocale, t } from '../../src/i18n/index.js';

const mocks = vi.hoisted(() => ({
  subscriptions: { value: [] },
  saveData: vi.fn(),
  fetchNodeCount: vi.fn(),
  batchUpdateNodes: vi.fn(),
  showToast: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('pinia', () => ({ storeToRefs: () => ({ subscriptions: mocks.subscriptions }) }));
vi.mock('../../src/stores/useDataStore', () => ({
  useDataStore: () => ({
    addSubscription: (sub) => mocks.subscriptions.value.unshift(sub),
    saveData: mocks.saveData,
    settings: { autoUpdateInterval: 0 },
  }),
}));
vi.mock('../../src/stores/toast.js', () => ({
  useToastStore: () => ({ showToast: mocks.showToast }),
}));
vi.mock('../../src/lib/api.js', () => ({
  fetchNodeCount: mocks.fetchNodeCount,
  batchUpdateNodes: mocks.batchUpdateNodes,
}));
vi.mock('../../src/utils/errorHandler.js', () => ({ handleError: mocks.handleError }));

const source = (id) => ({
  id,
  name: id,
  url: `https://example.com/${id}`,
  enabled: true,
  enableNodeCache: true,
  nodeCount: 12,
});
const success = { success: true, data: { count: 24, userInfo: { total: 100 } } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscriptions = ref([]);
  mocks.fetchNodeCount.mockReset();
  mocks.batchUpdateNodes.mockReset();
  setLocale('zh-CN');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('subscription refresh outcome feedback', () => {
  it('returns true on a successful refresh and saves the new data', async () => {
    mocks.subscriptions.value = [source('one')];
    mocks.fetchNodeCount.mockResolvedValue(success);
    expect(await useSubscriptions(vi.fn()).handleUpdateNodeCount('one')).toBe(true);
    expect(mocks.subscriptions.value[0].nodeCount).toBe(24);
    expect(mocks.saveData).toHaveBeenCalledOnce();
  });

  it.each(['api', 'exception', 'cancelled', 'missing'])(
    'returns false when a refresh fails through %s',
    async (kind) => {
      mocks.subscriptions.value = kind === 'missing' ? [] : [source('one')];
      if (kind === 'exception') mocks.fetchNodeCount.mockRejectedValue(new Error('Network down'));
      else
        mocks.fetchNodeCount.mockResolvedValue({
          success: false,
          error: 'Fetch failed',
          cancelled: kind === 'cancelled',
        });
      expect(await useSubscriptions(vi.fn()).handleUpdateNodeCount('one')).toBe(false);
      if (kind !== 'missing') expect(mocks.subscriptions.value[0].isUpdating).toBe(false);
      if (kind === 'cancelled') expect(mocks.showToast).not.toHaveBeenCalled();
    }
  );

  it.each(['zh-CN', 'en-US'])('counts partial import failures in %s', async (locale) => {
    setLocale(locale);
    mocks.fetchNodeCount.mockResolvedValueOnce(success).mockResolvedValueOnce({
      success: false,
      errorType: 'network',
      error: 'Network down',
    });
    await useSubscriptions(vi.fn()).addSubscriptionsFromBulk([source('one'), source('two')]);
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      t('subscriptions.bulkUpdatePartial', { failed: 1, total: 2 }),
      'warning'
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      t('subscriptions.bulkImportUpdateDone'),
      'success'
    );
    expect(mocks.subscriptions.value.find((sub) => sub.id === 'two').nodeCount).toBe(12);
  });

  it('counts unexpected exceptions and cancellations as failed import refreshes', async () => {
    mocks.fetchNodeCount.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce({
      success: false,
      cancelled: true,
    });
    await useSubscriptions(vi.fn()).addSubscriptionsFromBulk([source('one'), source('two')]);
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      t('subscriptions.bulkUpdatePartial', { failed: 2, total: 2 }),
      'warning'
    );
  });

  it('reports completion when all imported sources refresh successfully', async () => {
    mocks.fetchNodeCount.mockResolvedValue(success);
    await useSubscriptions(vi.fn()).addSubscriptionsFromBulk([source('one'), source('two')]);
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      t('subscriptions.bulkImportUpdateDone'),
      'success'
    );
  });

  it('uses a warning when refresh-all only succeeds for some sources', async () => {
    mocks.subscriptions.value = [source('one'), source('two')];
    mocks.batchUpdateNodes.mockResolvedValue({
      success: true,
      results: [{ subscriptionId: 'one', success: true, nodeCount: 24 }],
    });
    mocks.fetchNodeCount.mockResolvedValue(success);
    await useSubscriptions(vi.fn()).batchUpdateAllSubscriptions();
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      t('subscriptions.refreshDone', { success: 1, total: 2, failed: 1 }),
      'warning'
    );
    expect(mocks.subscriptions.value.every((sub) => !sub.isUpdating)).toBe(true);
  });
});

describe('subscription edit failure feedback', () => {
  it.each(['zh-CN', 'en-US'])('reports clone failure and allows retry in %s', (locale) => {
    setLocale(locale);
    const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription: vi.fn() });
    const cyclic = source('one');
    cyclic.circular = cyclic;
    forms.openEdit(cyclic);
    expect(forms.showModal.value).toBe(false);
    expect(mocks.showToast).toHaveBeenLastCalledWith(t('subscriptions.openEditFailed'), 'error');
    forms.openEdit(source('one'));
    expect(forms.showModal.value).toBe(true);
    expect(forms.editingSubscription.value.id).toBe('one');
  });

  it('reports an unavailable subscription instead of silently ignoring the edit', () => {
    const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription: vi.fn() });
    forms.openEdit(null);
    expect(mocks.showToast).toHaveBeenCalledWith(t('subscriptions.openEditFailed'), 'error');
    expect(forms.showModal.value).toBe(false);
  });

  it('preserves an existing new-subscription draft when opening another subscription fails', () => {
    const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription: vi.fn() });
    forms.openAdd();
    forms.editingSubscription.value.name = 'Unsaved draft';
    const cyclic = source('one');
    cyclic.circular = cyclic;
    forms.openEdit(cyclic);
    expect(forms.isNew.value).toBe(true);
    expect(forms.editingSubscription.value.name).toBe('Unsaved draft');
  });
});
