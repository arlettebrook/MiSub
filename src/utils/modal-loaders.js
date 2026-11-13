import { cachedLoader } from './load-timing.js';

const imports = {
    LogModal: () => import('../components/modals/LogModal.vue'),
    QRCodeModal: () => import('../components/modals/QRCodeModal.vue'),
    QRCodeOverlay: () => import('../components/public/QRCodeOverlay.vue'),
    NodePreviewModal: () => import('../components/modals/NodePreview/NodePreviewModal.vue'),
    BulkImportModal: () => import('../components/modals/BulkImportModal.vue'),
    ProfileModal: () => import('../components/modals/ProfileModal.vue'),
    SubscriptionEditModal: () => import('../components/modals/SubscriptionEditModal.vue'),
    ManualNodeEditModal: () => import('../components/modals/ManualNodeEditModal.vue'),
    ManualNodeDedupModal: () => import('../components/modals/ManualNodeDedupModal.vue'),
    SubscriptionImportModal: () => import('../components/modals/SubscriptionImportModal.vue'),
    BatchGroupModal: () => import('../components/modals/BatchGroupModal.vue'),
    GroupManagementModal: () => import('../components/modals/GroupManagementModal.vue'),
    SettingsModal: () => import('../components/modals/SettingsModal.vue'),
    CopyLinkModal: () => import('../components/modals/CopyLinkModal.vue'),
    MigrationModal: () => import('../components/modals/MigrationModal.vue'),
    LegacyD1MigrationModal: () => import('../components/modals/LegacyD1MigrationModal.vue'),
    VersionChangelogModal: () => import('../components/modals/VersionChangelogModal.vue'),
    GuestbookModal: () => import('../components/modals/GuestbookModal.vue'),
    QuickImportModal: () => import('../components/modals/QuickImportModal.vue'),
};

export const modalLoaders = Object.fromEntries(
    Object.entries(imports).map(([name, load]) => [name, cachedLoader(`misub:code:${name}`, load)])
);
export const loadQRCodeLibrary = cachedLoader('misub:code:qrcode', () => import('qrcode'));

export const commonModalPreloads = {
    logs: modalLoaders.LogModal,
    qrCode: modalLoaders.QRCodeModal,
};
export const publicModalPreloads = {
    qrCode: async () => {
        await modalLoaders.QRCodeOverlay();
        await loadQRCodeLibrary();
    },
};
