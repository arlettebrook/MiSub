<script setup>
    import { createLazyModal } from '../utils/lazy-modal.js';
    import { ref, nextTick, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import { normalizeDashboardQuery } from '../utils/dashboard-deeplink.js';
    import { useDataStore } from '../stores/useDataStore.js';
    import { useProfiles } from '../composables/useProfiles.js';
    import ProfilePanel from '../components/profiles/ProfilePanel.vue';
    import Modal from '../components/forms/Modal.vue';
    import { storeToRefs } from 'pinia';
    import { useManualNodes } from '../composables/useManualNodes.js';
    import { useToastStore } from '../stores/toast.js';
    import { useI18n } from '../i18n/index.js';
    import { useLazyModals } from '../composables/useLazyModals.js';

    const { t } = useI18n();

    const dataStore = useDataStore();
    const { markDirty } = dataStore;
    const { showToast } = useToastStore();
    const isProfileSorting = ref(false);

    const {
        profiles,
        editingProfile,
        isNewProfile,
        showProfileModal,
        showDeleteProfilesModal,
        handleProfileToggle,
        handleAddProfile,
        handleEditProfile,
        handleSaveProfile,
        handleDeleteProfile,
        handleDeleteAllProfiles,
        filteredProfiles,
        searchQuery: profileSearchQuery,
        profilesCurrentPage,
        profilesTotalPages,
        paginatedProfiles,
        changeProfilesPage,
    } = useProfiles(markDirty);
    const route = useRoute();
    const profilesSection = ref(null);
    watch(
        [() => route.path, () => route.query.focus],
        async ([path, focus]) => {
            if (
                path !== '/dashboard/subscriptions' ||
                normalizeDashboardQuery(focus) !== 'profiles'
            )
                return;
            profilesCurrentPage.value = 1;
            await nextTick();
            profilesSection.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        },
        { immediate: true }
    );

    // For ProfileModal need access to all subscriptions and nodes
    const { subscriptions } = storeToRefs(dataStore);
    const { manualNodes } = useManualNodes(markDirty);

    const handleProfileReorder = (profileId, direction) => {
        const fromIndex = profiles.value.findIndex(
            (profile) => profile.id === profileId || profile.customId === profileId
        );
        if (fromIndex === -1) return;

        const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
        if (toIndex < 0 || toIndex >= profiles.value.length) return;

        const [item] = profiles.value.splice(fromIndex, 1);
        profiles.value.splice(toIndex, 0, item);
        markDirty();
    };

    const toggleProfileSorting = () => {
        isProfileSorting.value = !isProfileSorting.value;
    };

    const NodePreviewModal = createLazyModal('NodePreviewModal');
    const showNodePreviewModal = ref(false);
    const previewProfileId = ref(null);
    const previewProfileName = ref('');

    const handlePreviewProfile = (profileId) => {
        const profile = profiles.value.find((p) => p.id === profileId || p.customId === profileId);
        if (profile) {
            previewProfileId.value = profileId;
            previewProfileName.value = profile.name;
            showNodePreviewModal.value = true;
        }
    };

    const ProfileModal = createLazyModal('ProfileModal');
    const LogModal = createLazyModal('LogModal');
    const CopyLinkModal = createLazyModal('CopyLinkModal');

    const showLogModal = ref(false);
    const logProfileName = ref('');

    const showCopyModal = ref(false);
    const showCopyModalProfile = ref(null);

    const handleOpenCopy = (profileId) => {
        const profile = profiles.value.find((p) => p.id === profileId || p.customId === profileId);
        if (profile) {
            showCopyModalProfile.value = profile;
            showCopyModal.value = true;
        }
    };

    const handleViewLogs = (profileId) => {
        const profile = profiles.value.find((p) => p.id === profileId || p.customId === profileId);
        if (profile) {
            logProfileName.value = profile.name;
            showLogModal.value = true;
        }
    };

    // QRCode
    const QRCodeModal = createLazyModal('QRCodeModal');
    const showQRCodeModal = ref(false);
    const mountedModals = useLazyModals({
        logs: showLogModal,
        preview: showNodePreviewModal,
        qrCode: showQRCodeModal,
    });
    const qrCodeUrl = ref('');
    const qrCodeTitle = ref('');
    const { settings } = storeToRefs(dataStore); // Check if settings is already imported or available from dataStore

    const handleQRCode = (profileId) => {
        const profile = profiles.value.find((p) => p.id === profileId || p.customId === profileId);
        if (profile) {
            if (!settings.value.profileToken) {
                showToast(t('notices.noToken'), 'error');
                return;
            }
            const token = settings.value.profileToken;
            const baseUrl = window.location.origin;
            // Use customId if available, otherwise use id
            const idToUse = profile.customId || profile.id;
            qrCodeUrl.value = `${baseUrl}/${token}/${idToUse}`;
            qrCodeTitle.value = profile.name || t('profiles.qrCodeTitle');
            showQRCodeModal.value = true;
        }
    };
</script>

<template>
    <div ref="profilesSection" class="max-w-(--breakpoint-xl) mx-auto scroll-mt-24">
        <ProfilePanel
            :profiles="profiles"
            :paginated-profiles="paginatedProfiles"
            :current-page="profilesCurrentPage"
            :search-query="profileSearchQuery"
            :filtered-count="filteredProfiles.length"
            searchable
            :total-pages="profilesTotalPages"
            :is-sorting="isProfileSorting"
            @add="handleAddProfile"
            @edit="handleEditProfile"
            @delete="handleDeleteProfile"
            @deleteAll="showDeleteProfilesModal = true"
            @toggle="handleProfileToggle"
            @openCopy="handleOpenCopy"
            @preview="handlePreviewProfile"
            @reorder="handleProfileReorder"
            @toggle-sort="toggleProfileSorting"
            @change-page="changeProfilesPage"
            @viewLogs="handleViewLogs"
            @qrcode="handleQRCode"
            @update-search="profileSearchQuery = $event"
        />

        <LogModal
            v-if="mountedModals.has('logs')"
            :show="showLogModal"
            @update:show="showLogModal = $event"
            :filter-profile-name="logProfileName"
        />

        <ProfileModal
            v-if="showProfileModal"
            v-model:show="showProfileModal"
            :profile="editingProfile"
            :is-new="isNewProfile"
            :all-subscriptions="subscriptions"
            :all-manual-nodes="manualNodes"
            @save="handleSaveProfile"
            size="6xl"
        />

        <Modal v-model:show="showDeleteProfilesModal" @confirm="handleDeleteAllProfiles">
            <template #title>
                <h3 class="text-lg font-bold text-red-500">
                    {{ t('profiles.deleteAllConfirmTitle') }}
                </h3>
            </template>
            <template #body>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ t('profiles.deleteAllConfirmBody') }}
                </p>
            </template>
        </Modal>

        <NodePreviewModal
            v-if="mountedModals.has('preview')"
            :show="showNodePreviewModal"
            :subscription-id="null"
            :subscription-name="''"
            :subscription-url="''"
            :profile-id="previewProfileId"
            :profile-name="previewProfileName"
            @update:show="showNodePreviewModal = $event"
        />

        <QRCodeModal
            v-if="mountedModals.has('qrCode')"
            v-model:show="showQRCodeModal"
            :url="qrCodeUrl"
            :title="qrCodeTitle"
        />

        <CopyLinkModal
            v-if="showCopyModal && showCopyModalProfile"
            v-model:show="showCopyModal"
            :profile="showCopyModalProfile"
            :token="settings?.profileToken"
        />
    </div>
</template>
