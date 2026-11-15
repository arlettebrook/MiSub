import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useManualNodes } from '../../src/composables/useManualNodes.js';
import { useSubscriptions } from '../../src/composables/useSubscriptions.js';
import { useBulkImportLogic } from '../../src/composables/useBulkImportLogic.js';
import { isManualNodeSource, isRemoteSubscriptionSource } from '../../shared/node-source.js';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';
import { buildAutoSortedSubscriptions } from '../../src/composables/manual-nodes/sorting.js';
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast }) }));
beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('HTTP proxy UI source boundaries', () => {
    it('lists proxies as manual nodes and preserves ordinary subscription links', () => {
        const store = useDataStore();
        store.subscriptions = [
            {
                id: 'http',
                url: 'http://user:pass@edge.example:8080#Node',
                name: 'HTTP Node',
                enabled: true,
            },
            {
                id: 'https',
                url: 'https://edge.example:443#HTTPS',
                name: 'HTTPS Node',
                enabled: true,
            },
            {
                id: 'sub',
                url: 'https://sub.example:8443/sub?token=test',
                name: 'Subscription',
                enabled: true,
            },
        ];
        const manual = useManualNodes(vi.fn());
        const remote = useSubscriptions(vi.fn());
        expect(manual.manualNodes.value.map((node) => node.id)).toEqual(['http', 'https']);
        expect(remote.subscriptions.value.map((sub) => sub.id)).toEqual(['sub']);
        manual.reorderManualNodes([...manual.manualNodes.value].reverse());
        expect(store.subscriptions.map((node) => node.id)).toEqual(['https', 'http', 'sub']);
        expect(new Set(store.subscriptions.map((node) => node.id)).size).toBe(3);
        const sorted = buildAutoSortedSubscriptions(store.subscriptions, manual.manualNodes.value);
        expect(sorted).toHaveLength(3);
    });
    it('marks a bare endpoint added through the manual-node workflow', () => {
        const store = useDataStore();
        const manual = useManualNodes(vi.fn());
        manual.addNode({ id: 'bare', url: 'http://edge.example:80', name: 'Bare', enabled: true });
        expect(isManualNodeSource(store.subscriptions[0])).toBe(true);
        expect(manual.manualNodes.value).toHaveLength(1);
        expect(store.subscriptions[0].url).toContain(':80');
    });
    it('bulk imports named proxy links as nodes while plain endpoint and token links remain subscriptions', () => {
        const addSubscriptions = vi.fn(),
            addNodes = vi.fn();
        const bulk = useBulkImportLogic({
            addSubscriptionsFromBulk: addSubscriptions,
            addNodesFromBulk: addNodes,
        });
        bulk.handleBulkImport(
            'http://user:pass@edge.example:8080#Node\nhttps://edge.example:443#HTTPS\nhttps://sub.example:8443/sub?token=test\nhttp://sub.example:8080',
            'Group'
        );
        expect(addNodes.mock.calls[0][0]).toHaveLength(2);
        expect(addSubscriptions.mock.calls[0][0]).toHaveLength(2);
        expect(addNodes.mock.calls[0][0].every(isManualNodeSource)).toBe(true);
        expect(addSubscriptions.mock.calls[0][0].every(isRemoteSubscriptionSource)).toBe(true);
    });
    it('does not submit an HTTP proxy as a subscription', () => {
        const addSubscription = vi.fn(),
            updateSubscription = vi.fn();
        const form = useSubscriptionForms({ addSubscription, updateSubscription });
        form.openAdd();
        form.editingSubscription.value.url = 'http://user:pass@edge.example:8080#Node';
        form.handleSave();
        expect(addSubscription).not.toHaveBeenCalled();
        form.editingSubscription.value.url = 'https://sub.example:8443/sub?token=test';
        form.handleSave();
        expect(addSubscription).toHaveBeenCalledTimes(1);
    });
});
