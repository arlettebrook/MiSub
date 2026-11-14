import { defineComponent, h, onScopeDispose, provide, shallowRef, watch } from 'vue';
import LazyModalShell from '../components/modals/LazyModalShell.vue';
import { modalTriggerKey } from '../composables/modal-trigger.js';
import { useI18n } from '../i18n/index.js';
import { modalLoaders } from './modal-loaders.js';
import { modalDataKey, useModalData } from '../composables/useModalData.js';

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
    QRCodeModal: 'sm',
    QRCodeOverlay: 'sm',
    CopyLinkModal: 'sm',
    QuickImportModal: '4xl',
    BulkImportModal: '2xl',
    SubscriptionEditModal: '2xl',
    ManualNodeEditModal: '2xl',
    ManualNodeDedupModal: '2xl',
    SubscriptionImportModal: '2xl',
    GroupManagementModal: '2xl',
    MigrationModal: '2xl',
    LegacyD1MigrationModal: '2xl',
};
const bodyHeights = { LogModal: '60vh', NodePreviewModal: '60vh' };

export function createLazyModal(name, loader = modalLoaders[name]) {
    let resolved;
    let pending;
    const load = () =>
        (pending ||= Promise.resolve()
            .then(loader)
            .then((module) => {
                resolved = module.default || module;
                return resolved;
            })
            .catch((error) => {
                pending = undefined;
                throw error;
            }));
    const visibleProp = name === 'QRCodeOverlay' ? 'isExpanded' : 'show';
    return defineComponent({
        name: `${name}Loader`,
        inheritAttrs: false,
        props: {
            [visibleProp]: Boolean,
            ...(name === 'LogModal' ? { filterProfileName: String } : {}),
            ...(name === 'NodePreviewModal'
                ? {
                      apiEndpoint: String,
                      profileId: String,
                      subscriptionId: String,
                      subscriptionUrl: String,
                  }
                : {}),
        },
        setup(props, { attrs, slots }) {
            const { t } = useI18n();
            const trigger = shallowRef(null);
            const preloaded = loader.peek?.();
            const component = shallowRef(resolved || preloaded?.default || preloaded);
            const error = shallowRef(false);
            let disposed = false;
            onScopeDispose(() => (disposed = true));
            provide(modalTriggerKey, trigger);
            if (name === 'LogModal' || name === 'NodePreviewModal') {
                const data = useModalData(name, { inherit: false });
                provide(modalDataKey, data);
                watch(
                    () => [props[visibleProp], data.descriptor(props)],
                    ([show, descriptor]) => {
                        if (!show || !descriptor) data.resource.cancel();
                        else if (!component.value) data.resource.read(descriptor);
                    },
                    { immediate: true, flush: 'post' }
                );
            }
            const requestLoad = async () => {
                error.value = false;
                try {
                    const loaded = await load();
                    if (!disposed) component.value = loaded;
                } catch {
                    if (!disposed) error.value = true;
                }
            };
            watch(
                () => props[visibleProp],
                (show) => {
                    if (show) {
                        trigger.value =
                            typeof document === 'undefined' ? null : document.activeElement;
                        if (!component.value && !error.value) void requestLoad();
                    }
                },
                { immediate: true, flush: 'sync' }
            );
            const value = (key) =>
                attrs[key] ?? attrs[key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)];
            const close = () => {
                if (['QRCodeOverlay', 'GuestbookModal', 'QuickImportModal'].includes(name))
                    attrs.onClose?.();
                else attrs['onUpdate:show']?.(false);
            };
            return () =>
                h(
                    LazyModalShell,
                    {
                        show: props[visibleProp],
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
                        bodyHeight: bodyHeights[name],
                        bodyMinHeight: name === 'ProfileModal' ? '60vh' : undefined,
                        error: error.value,
                        onClose: close,
                        onRetry: requestLoad,
                    },
                    {
                        default: () =>
                            component.value
                                ? h(component.value, { ...attrs, ...props }, slots)
                                : null,
                    }
                );
        },
    });
}
