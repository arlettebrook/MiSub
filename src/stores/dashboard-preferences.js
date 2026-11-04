import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/http.js';
import {
    readDismissedHealthItemIds,
    writeDismissedHealthItemIds,
} from '../utils/health-item-dismissal.js';
import { useToastStore } from './toast.js';
import { useSessionStore } from './session.js';
import { t } from '../i18n/index.js';

const ENDPOINT = '/api/dashboard/preferences';
const PENDING_KEY = 'misub:dismissedHealthItems:pending';
const MIGRATED_KEY = 'misub:dismissedHealthItems:serverSynced';

function readLocal(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value == null ? fallback : JSON.parse(value);
    } catch {
        return fallback;
    }
}

function saveLocal(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Server persistence remains available when browser storage is blocked.
    }
}

function applyOperation(ids, operation) {
    if (operation.action === 'restore-all') return [];
    if (operation.action === 'restore') return ids.filter((id) => id !== operation.id);
    return [...new Set([...ids, operation.id])];
}

function responseIds(result) {
    if (result?.success !== true || !Array.isArray(result.data?.dismissedHealthItemIds)) {
        throw new Error('Invalid dashboard preferences response');
    }
    return result.data.dismissedHealthItemIds.filter((id) => typeof id === 'string' && id);
}

export const useDashboardPreferencesStore = defineStore('dashboard-preferences', () => {
    const { showToast } = useToastStore();
    const sessionStore = useSessionStore();
    const dismissedHealthItemIds = ref(readDismissedHealthItemIds());
    const isSyncing = ref(false);
    const storedPending = readLocal(PENDING_KEY, []);
    let pending = Array.isArray(storedPending)
        ? storedPending.filter(
              (op) =>
                  op &&
                  (op.action === 'restore-all' ||
                      (['dismiss', 'restore'].includes(op.action) &&
                          typeof op.id === 'string' &&
                          op.id))
          )
        : [];
    let migrated = readLocal(MIGRATED_KEY, false) === true;
    let syncing = null;
    let reportedError = false;

    function publish(ids) {
        dismissedHealthItemIds.value = pending.reduce(applyOperation, ids);
        writeDismissedHealthItemIds(dismissedHealthItemIds.value);
    }

    function canSync() {
        return sessionStore.sessionState === 'loggedIn' && !sessionStore.isLoggingOut;
    }

    async function sync() {
        if (!canSync()) return false;
        if (syncing) return syncing;
        isSyncing.value = true;
        syncing = (async () => {
            try {
                let result = await api.get(ENDPOINT, { background: true });
                if (!canSync()) return false;
                let ids = responseIds(result);
                if (!migrated) {
                    if (!result.initialized && dismissedHealthItemIds.value.length > 0) {
                        result = await api.post(
                            ENDPOINT,
                            { action: 'migrate', ids: dismissedHealthItemIds.value },
                            { background: true }
                        );
                        if (!canSync()) return false;
                        ids = responseIds(result);
                    }
                    migrated = true;
                    saveLocal(MIGRATED_KEY, true);
                }
                publish(ids);
                while (pending.length > 0) {
                    result = await api.post(ENDPOINT, pending[0], { background: true });
                    if (!canSync()) return false;
                    ids = responseIds(result);
                    pending.shift();
                    saveLocal(PENDING_KEY, pending);
                    publish(ids);
                }
                reportedError = false;
                return true;
            } catch (error) {
                if (canSync() && !error?.cancelled && error?.status !== 401 && !reportedError) {
                    showToast(t('dashboard.health.syncFailed'), 'error');
                    reportedError = true;
                }
                return false;
            } finally {
                isSyncing.value = false;
                syncing = null;
            }
        })();
        return syncing;
    }

    function change(action, id) {
        if (action !== 'restore-all') {
            id = String(id || '').trim();
            if (!id) return Promise.resolve(false);
        }
        const operation = action === 'restore-all' ? { action } : { action, id };
        pending.push(operation);
        saveLocal(PENDING_KEY, pending);
        dismissedHealthItemIds.value = applyOperation(dismissedHealthItemIds.value, operation);
        writeDismissedHealthItemIds(dismissedHealthItemIds.value);
        return sync();
    }

    return {
        dismissedHealthItemIds,
        isSyncing,
        sync,
        dismiss: (id) => change('dismiss', id),
        restore: (id) => change('restore', id),
        restoreAll: () => change('restore-all'),
    };
});
