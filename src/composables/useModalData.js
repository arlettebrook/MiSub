import { computed, getCurrentInstance, inject, onScopeDispose, ref, watch } from 'vue';
import { useDataStore } from '../stores/useDataStore.js';
import {
    createModalDataResource,
    MODAL_DATA_TTL,
    modalDataDescriptor,
} from '../utils/modal-data.js';

export const modalDataKey = Symbol('modal-data');

export function useModalData(name, { inherit = true } = {}) {
    const shared = inherit ? inject(modalDataKey, null) : null;
    if (shared?.name === name) return shared;

    const pinia = getCurrentInstance()?.appContext.config.globalProperties.$pinia;
    const store = pinia ? useDataStore(pinia) : null;
    const revision = ref(0);
    const processed = ref(true);
    const resource = createModalDataResource({
        ttl: MODAL_DATA_TTL[name],
        accepts: (data) =>
            data?.success !== false &&
            (name === 'LogModal'
                ? Array.isArray(data?.data)
                : data?.success &&
                  Array.isArray(data.nodes) &&
                  !(data.subscriptions || []).some((source) => !source.success)),
    });
    if (store)
        watch(
            [() => store.modalDataRevision, () => store.settings],
            () => {
                revision.value++;
                resource.invalidate();
            },
            { flush: 'sync' }
        );
    onScopeDispose(resource.invalidate);
    return {
        name,
        resource,
        processed,
        descriptor: (props) => modalDataDescriptor(name, props, processed.value, revision.value),
        revision: computed(() => revision.value),
    };
}
