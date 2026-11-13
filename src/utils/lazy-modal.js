import { defineAsyncComponent, defineComponent, h, provide, shallowRef, watch } from 'vue';
import ModalLoading from '../components/modals/ModalLoading.vue';
import { modalTriggerKey } from '../composables/modal-trigger.js';
import { useI18n } from '../i18n/index.js';
import { modalLoaders } from './modal-loaders.js';

const titles = {
    LogModal: 'logs.title',
    QRCodeModal: 'qr.title',
    QRCodeOverlay: 'qr.title',
    NodePreviewModal: 'nodePreview.unknownSubscription',
    BulkImportModal: 'bulkImport.title',
    ProfileModal: 'profiles.editTitle',
    SubscriptionEditModal: 'subscriptions.editTitle',
    ManualNodeEditModal: 'manualNodes.editTitle',
    ManualNodeDedupModal: 'manualNodes.dedupConfirmTitle',
    SubscriptionImportModal: 'importNodes.title',
    BatchGroupModal: 'manualNodes.batchMoveGroupTitle',
    GroupManagementModal: 'actions.manageGroups',
    SettingsModal: 'settings.title',
    CopyLinkModal: 'copyLink.title',
    MigrationModal: 'systemSettings.migrateToD1',
    LegacyD1MigrationModal: 'systemSettings.migrateToD1',
    VersionChangelogModal: 'changelog.title',
    GuestbookModal: 'guestbook.submitFeedback',
    QuickImportModal: 'quickImport.title',
};
const sizes = {
    LogModal: '4xl',
    NodePreviewModal: '6xl',
    ProfileModal: '6xl',
    SettingsModal: '6xl',
};

export function createLazyModal(name, loader = modalLoaders[name]) {
    const error = shallowRef(false);
    let retryLoad;
    const Loading = defineComponent({
        inheritAttrs: false,
        setup(_, { attrs }) {
            const { t } = useI18n();
            const value = (key) =>
                attrs[key] ?? attrs[key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)];
            return () =>
                h(ModalLoading, {
                    show: attrs.show || attrs.isExpanded,
                    title:
                        attrs.title ||
                        value('profileName') ||
                        value('subscriptionName') ||
                        attrs.profile?.name ||
                        t(
                            value('isNew') && titles[name]?.endsWith('.editTitle')
                                ? titles[name].replace('.editTitle', '.addTitle')
                                : titles[name] || 'common.confirmAction'
                        ),
                    size: attrs.size || sizes[name] || 'lg',
                    error: error.value,
                    onClose: () => {
                        if (
                            name === 'QRCodeOverlay' ||
                            name === 'GuestbookModal' ||
                            name === 'QuickImportModal'
                        )
                            attrs.onClose?.();
                        else attrs['onUpdate:show']?.(false);
                    },
                    onRetry: () => {
                        error.value = false;
                        retryLoad?.();
                    },
                });
        },
    });
    const AsyncModal = defineAsyncComponent({
        loader,
        delay: 0,
        loadingComponent: Loading,
        onError(_, retry) {
            error.value = true;
            retryLoad = retry;
        },
    });
    const visibleProp = name === 'QRCodeOverlay' ? 'isExpanded' : 'show';
    return defineComponent({
        name: `${name}Loader`,
        inheritAttrs: false,
        props: { [visibleProp]: Boolean },
        setup(props, { attrs, slots }) {
            const trigger = shallowRef(null);
            provide(modalTriggerKey, trigger);
            watch(
                () => props[visibleProp],
                (show) => {
                    if (show)
                        trigger.value =
                            typeof document === 'undefined' ? null : document.activeElement;
                },
                { immediate: true, flush: 'sync' }
            );
            return () => h(AsyncModal, { ...attrs, ...props }, slots);
        },
    });
}
