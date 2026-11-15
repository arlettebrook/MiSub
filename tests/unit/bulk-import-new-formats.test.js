import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
    useBulkImportLogic,
    needsServerParsing,
} from '../../src/composables/useBulkImportLogic.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { isManualNodeSource, isRemoteSubscriptionSource } from '../../shared/node-source.js';
const { post, showToast } = vi.hoisted(() => ({ post: vi.fn(), showToast: vi.fn() }));
vi.mock('../../src/lib/http.js', async () => ({
    ...(await vi.importActual('../../src/lib/http.js')),
    api: { post },
}));
vi.mock('../../src/stores/toast.js', () => ({ useToastStore: () => ({ showToast }) }));
beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());
const newLink = 'v2rayn://vless/eyJhIjoidGVzdCJ9';
const standard = 'vless://11111111-1111-4111-8111-111111111111@edge.example:443#Test';
describe('bulk import of v2rayN/Mieru configurations', () => {
    it.each([
        newLink,
        'mierus://user:pass@edge.example?profile=default&port=443&protocol=TCP',
        'mieru://base64',
        'proxies:\n - type: mieru',
        '{"outbounds":[]}',
    ])('uses backend parsing for %s', (input) => {
        expect(needsServerParsing(input)).toBe(true);
    });
    it('parses special links first and keeps ordinary subscription URLs separate', async () => {
        post.mockResolvedValue({
            success: true,
            data: { nodes: [{ name: 'Test', url: standard }] },
        });
        const addNodes = vi.fn(),
            addSubscriptions = vi.fn();
        const bulk = useBulkImportLogic({
            addSubscriptionsFromBulk: addSubscriptions,
            addNodesFromBulk: addNodes,
        });
        await bulk.handleBulkImport(newLink + '\nhttps://sub.example/sub?token=test', 'Group');
        expect(post).toHaveBeenCalledWith('/api/parse_subscription', {
            content: newLink + '\nhttps://sub.example/sub?token=test',
        });
        expect(addNodes.mock.calls[0][0]).toHaveLength(1);
        expect(addNodes.mock.calls[0][0][0]).toMatchObject({ url: standard, group: 'Group' });
        expect(addNodes.mock.calls[0][0].every(isManualNodeSource)).toBe(true);
        expect(addSubscriptions.mock.calls[0][0].every(isRemoteSubscriptionSource)).toBe(true);
    });
    it('does not persist unconverted profiles when the backend rejects them', async () => {
        post.mockResolvedValue({ success: true, data: { nodes: [] } });
        const addNodes = vi.fn();
        const bulk = useBulkImportLogic({
            addSubscriptionsFromBulk: vi.fn(),
            addNodesFromBulk: addNodes,
        });
        await bulk.handleBulkImport(newLink, '');
        expect(addNodes).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
    });
    it('reports a request failure and keeps the importer open', async () => {
        post.mockRejectedValue(new Error('network unavailable'));
        const addNodes = vi.fn();
        const bulk = useBulkImportLogic({
            addSubscriptionsFromBulk: vi.fn(),
            addNodesFromBulk: addNodes,
        });
        bulk.showModal.value = true;
        await bulk.handleBulkImport(newLink, '');
        expect(addNodes).not.toHaveBeenCalled();
        expect(bulk.showModal.value).toBe(true);
    });
    it('deduplicates converted output and current nodes', async () => {
        useDataStore().subscriptions = [{ id: 'old', url: standard }];
        post.mockResolvedValue({
            success: true,
            data: { nodes: [{ url: standard }, { url: standard }] },
        });
        const addNodes = vi.fn();
        await useBulkImportLogic({
            addSubscriptionsFromBulk: vi.fn(),
            addNodesFromBulk: addNodes,
        }).handleBulkImport(newLink, '');
        expect(addNodes).not.toHaveBeenCalled();
    });
    it('keeps standard import synchronous before its promise completes without making API requests', () => {
        const addNodes = vi.fn();
        useBulkImportLogic({
            addSubscriptionsFromBulk: vi.fn(),
            addNodesFromBulk: addNodes,
        }).handleBulkImport(standard, '');
        expect(addNodes).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();
    });
});
